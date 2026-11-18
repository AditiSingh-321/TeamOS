import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase,asUser,asWorker,rpc } from "./database.mjs";
import { ingestDocument } from "../src/lib/knowledge/ingestion.ts";
import { answerQuestion } from "../src/lib/knowledge/rag.ts";
import { vectorAt } from "./knowledge-fixtures.mjs";

test("document upload, durable ingestion, pgvector retrieval, citations and tenant isolation",async(t)=>{
  const originalMode=process.env.RAG_RETRIEVAL_MODE;process.env.RAG_RETRIEVAL_MODE="semantic";
  const db=await createDatabase();
  const owner="f7000000-0000-4000-8000-000000000001",member="f7000000-0000-4000-8000-000000000002",outsider="f7000000-0000-4000-8000-000000000003";
  const bytes=Buffer.from("Authentication uses JWT with rotating refresh tokens.");
  let workspace,project,otherProject,foreignProject,document;
  const files=new Map();
  async function reserve(name="architecture.txt") {
    return rpc(db,"reserve_document",[project,name,"text/plain",bytes.length]);
  }
  async function upload(doc) {
    // Model Storage's row authorization; private bytes are accessed only after this check.
    await db.query("insert into storage.objects(bucket_id,name) values('project-documents',$1)",[doc.storage_path]); files.set(doc.storage_path,bytes);
    await rpc(db,"queue_document",[doc.id]);
  }
  async function search(pid=project) { return (await db.query("select * from public.search_project_documents($1,$2::extensions.vector,6,0.25)",[pid,JSON.stringify(vectorAt())])).rows; }
  try {
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'owner@rag.test',now(),'{}'),($2,'member@rag.test',now(),'{}'),($3,'outsider@rag.test',now(),'{}')",[owner,member,outsider]);
    await asUser(db,owner);workspace=await rpc(db,"create_workspace",["Knowledge"]);
    project=(await db.query("insert into public.projects(workspace_id,name) values($1,'Primary') returning id",[workspace])).rows[0].id;
    otherProject=(await db.query("insert into public.projects(workspace_id,name) values($1,'Other') returning id",[workspace])).rows[0].id;
    await db.exec("reset role");await db.query("insert into public.workspace_members(workspace_id,user_id,role,display_name) values($1,$2,'member','Member')",[workspace,member]);
    await asUser(db,outsider);const foreignWorkspace=await rpc(db,"create_workspace",["Private"]);
    foreignProject=(await db.query("insert into public.projects(workspace_id,name) values($1,'Private') returning id",[foreignWorkspace])).rows[0].id;
    await asUser(db,owner);

    await t.test("bucket is private, document reservations enforce scope, format and storage paths",async()=>{
      await db.exec("reset role");assert.equal((await db.query("select public from storage.buckets where id='project-documents'")).rows[0].public,false);await asUser(db,owner);
      await assert.rejects(rpc(db,"reserve_document",[foreignProject,"x.txt","text/plain",20]),/unavailable/);
      await assert.rejects(rpc(db,"reserve_document",[project,"x.exe","text/plain",20]),/Unsupported/);
      document=await reserve();assert.equal(document.project_id,project);assert(document.storage_path.startsWith(`${workspace}/${project}/${document.id}/`));
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('project-documents','forged/path.txt')"),/row-level/);
      await upload(document);
    });
    await t.test("worker claims a job, checkpoints embeddings and atomically publishes ready chunks",async()=>{
      await assert.rejects(rpc(db,"claim_document_job"),/permission/);
      await asWorker(db);const {job,document:record}=await rpc(db,"claim_document_job");assert.equal(job.document_id,document.id);
      await ingestDocument(record,{
        download:async()=>files.get(record.storage_path),cached:async()=>[],embed:async(texts)=>texts.map(()=>vectorAt()),
        checkpoint:async(chunks)=>{assert(await rpc(db,"checkpoint_document_embeddings",[job.id,job.lease_token,chunks]));},
        finish:(chunks,hash)=>rpc(db,"finish_document_job",[job.id,job.lease_token,chunks,hash]),
      });
      await asUser(db,owner);assert.equal((await db.query("select processing_status from public.project_documents where id=$1",[document.id])).rows[0].processing_status,"Ready");
      assert.equal((await search()).length,1);assert.equal((await search(otherProject)).length,0);
      const rows=await search();
      const answer=await answerQuestion({question:"What authentication method is documented?"},{
        authorize:async()=>{},reserve:()=>rpc(db,"reserve_rag_question",[project]),rewrite:async(q)=>q,
        embed:async()=>[vectorAt()],search:async()=>search(),
        answer:async()=>({supported:true,claims:[{text:"Authentication uses JWT with rotating refresh tokens.",evidence:[{source:1,quote:rows[0].content}]}]}),
        stillAvailable:async(ids)=>(await db.query("select id from public.document_chunks where id=any($1::uuid[])",[ids])).rows.map(row=>row.id),
      });
      assert.equal(answer.abstained,false);assert.equal(answer.citations[0].document_id,document.id);assert.match(answer.answer,/\[1\]/);
    });
    await t.test("outsiders cannot read, download, search, retry or delete another workspace's files",async()=>{
      await asUser(db,outsider);
      assert.equal((await db.query("select * from public.project_documents")).rows.length,0);
      assert.equal((await db.query("select * from storage.objects where name=$1",[document.storage_path])).rows.length,0);
      assert.equal((await search()).length,0);
      await assert.rejects(rpc(db,"queue_document",[document.id]),/unavailable/);
      await assert.rejects(rpc(db,"delete_document",[document.id]),/unavailable/);
      await assert.rejects(rpc(db,"reserve_rag_question",[project]),/unavailable/);
      await asUser(db,member);assert.equal((await search()).length,1);
      await assert.rejects(rpc(db,"delete_document",[document.id]),/unavailable/);
      assert.equal((await db.query("select * from storage.objects where name=$1",[document.storage_path])).rows.length,1);
    });
    await t.test("deletion immediately removes search results and failed storage cleanup remains retryable",async()=>{
      await asUser(db,owner);await rpc(db,"delete_document",[document.id]);assert.equal((await search()).length,0);
      assert.equal((await db.query("select * from storage.objects where name=$1",[document.storage_path])).rows.length,0);
      await asWorker(db);let {job}=await rpc(db,"claim_document_job");assert.equal(job.kind,"cleanup");
      await rpc(db,"fail_document_job",[job.id,job.lease_token,"Storage unavailable",false]);
      await db.exec("reset role;update private.document_jobs set available_at=now() where kind='cleanup' and state='queued'");await asWorker(db);
      ({job}=await rpc(db,"claim_document_job"));files.delete(job.storage_path);await db.query("delete from storage.objects where name=$1",[job.storage_path]);
      assert(await rpc(db,"finish_document_job",[job.id,job.lease_token]));
      await asUser(db,owner);assert.equal((await db.query("select * from public.document_chunks")).rows.length,0);
    });
    await t.test("failed processing retries are leased and stale completion cannot publish chunks",async()=>{
      const doc=await reserve("retry.txt");await upload(doc);await asWorker(db);const first=await rpc(db,"claim_document_job");
      await rpc(db,"fail_document_job",[first.job.id,first.job.lease_token,"Temporary embedding failure",false]);
      await db.exec("reset role;update private.document_jobs set available_at=now() where kind='ingest' and state='queued'");await asWorker(db);const next=await rpc(db,"claim_document_job");
      assert.notEqual(first.job.lease_token,next.job.lease_token);
      assert.equal(await rpc(db,"finish_document_job",[first.job.id,first.job.lease_token,[],null]),false);
      await rpc(db,"fail_document_job",[next.job.id,next.job.lease_token,"Scanned PDFs are unsupported",true]);
      await asUser(db,owner);const row=(await db.query("select * from public.project_documents where id=$1",[doc.id])).rows[0];assert.equal(row.processing_status,"Failed");
      await rpc(db,"queue_document",[doc.id]);await asWorker(db);const retried=await rpc(db,"claim_document_job");assert.equal(retried.job.attempts,1);
      await asUser(db,owner);await rpc(db,"delete_document",[doc.id]);await asWorker(db);
      assert.equal(await rpc(db,"finish_document_job",[retried.job.id,retried.job.lease_token,[],null]),false);
    });
    await t.test("project deletion leaves a durable file cleanup job",async()=>{
      await asUser(db,owner);const doc=await reserve("orphan.txt");await upload(doc);
      await db.query("delete from public.projects where id=$1",[project]);
      await db.exec("reset role");const row=(await db.query("select * from private.document_jobs where document_id=$1 and kind='cleanup'",[doc.id])).rows[0];assert.equal(row.state,"queued");assert.equal(row.storage_path,doc.storage_path);
    });
  } finally {await db.close();if(originalMode===undefined)delete process.env.RAG_RETRIEVAL_MODE;else process.env.RAG_RETRIEVAL_MODE=originalMode;}
});
