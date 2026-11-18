import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDatabase, asUser, asWorker, rpc } from "./database.mjs";
import { embedTexts, knowledgeConfiguration, structuredResponse, answerSchema } from "../src/lib/knowledge/provider.ts";
import { retrievalMode } from "../src/lib/knowledge/config.ts";
import { ingestDocument } from "../src/lib/knowledge/ingestion.ts";
import { answerQuestion } from "../src/lib/knowledge/rag.ts";
import { vectorAt } from "./knowledge-fixtures.mjs";

test("Sarvam RAG configuration never falls back to OpenAI credentials",()=>{
  const saved={...process.env};
  try {
    delete process.env.SARVAM_API_KEY;delete process.env.RAG_RETRIEVAL_MODE;
    process.env.OPENAI_API_KEY="unrelated-openai-key";
    assert.equal(retrievalMode(),"fulltext");assert.throws(knowledgeConfiguration,/SARVAM_API_KEY/);
    process.env.SARVAM_API_KEY=" sarvam-test-key ";delete process.env.SARVAM_MODEL;
    assert.deepEqual(knowledgeConfiguration(),{key:"sarvam-test-key",model:"sarvam-105b"});
    process.env.RAG_RETRIEVAL_MODE="invalid";assert.throws(retrievalMode,/fulltext or semantic/);
  }finally{process.env=saved;}
});
test("real SDK routes embedding and answer calls only to Sarvam with correct prefixes and dimensions",async()=>{
  const saved={...process.env},originalFetch=globalThis.fetch;
  try {
    process.env.SARVAM_API_KEY="sarvam-test-key";delete process.env.SARVAM_MODEL;delete process.env.SARVAM_EMBEDDING_MODEL;
    process.env.OPENAI_BASE_URL="https://example.invalid";
    const requests=[];
    globalThis.fetch=async(url,options)=>{
      const headers=new Headers(options.headers);assert.equal(headers.get("api-subscription-key"),"sarvam-test-key");
      const body=JSON.parse(options.body);requests.push({url:String(url),body});
      if(String(url)==="https://api.sarvam.ai/v2/embeddings"){
        assert.equal(body.model,"embeddinggemma-2");assert(!("dimensions" in body));
        return Response.json({object:"list",data:[{object:"embedding",index:0,embedding:vectorAt()}]});
      }
      assert.equal(String(url),"https://api.sarvam.ai/v2/responses");assert.equal(body.model,"sarvam-105b");assert.equal(body.store,false);
      assert.equal(body.text.format.type,"json_schema");
      return Response.json({id:"resp_test",object:"response",created_at:1,status:"completed",model:body.model,output:[{type:"message",id:"msg_test",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify({supported:false,claims:[]}),annotations:[]}]}]});
    };
    assert.equal((await embedTexts(["JWT authentication"]))[0].length,768);
    await embedTexts(["Which authentication?"],undefined,"query");
    await structuredResponse(answerSchema,"answer","Use only evidence.",{question:"JWT?"});
    assert.match(requests[0].body.input[0],/^title: none \| text: /);
    assert.match(requests[1].body.input[0],/^task: search result \| query: /);
    assert.equal(requests.length,3);
  }finally{globalThis.fetch=originalFetch;process.env=saved;}
});

test("Sarvam migration preserves documents and text, discards incompatible vectors, and supports full-text RAG without embeddings",async()=>{
  const saved={...process.env};delete process.env.RAG_RETRIEVAL_MODE;
  const db=await createDatabase({beforeSarvam:true});
  const user="f7300000-0000-4000-8000-000000000001",outsider="f7300000-0000-4000-8000-000000000002";
  const content="Authentication uses JWT with rotating refresh tokens.";
  try {
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'owner@sarvam.test',now(),'{}'),($2,'outsider@sarvam.test',now(),'{}')",[user,outsider]);await asUser(db,user);
    const workspace=await rpc(db,"create_workspace",["Sarvam workspace"]);
    const project=(await db.query("insert into public.projects(workspace_id,name) values($1,'Sarvam') returning id",[workspace])).rows[0].id;
    const doc=await rpc(db,"reserve_document",[project,"architecture.txt","text/plain",Buffer.byteLength(content)]);
    await db.query("insert into storage.objects(bucket_id,name) values('project-documents',$1)",[doc.storage_path]);await rpc(db,"queue_document",[doc.id]);
    await asWorker(db);const {job}=await rpc(db,"claim_document_job");
    const legacy=Array(1536).fill(0);legacy[0]=1;
    const oldChunks=[{chunk_index:0,content,content_hash:"legacy",embedding:legacy,page_number:null,section_title:null}];
    await rpc(db,"finish_document_job",[job.id,job.lease_token,oldChunks,"legacy-file-hash"]);
    await db.exec("reset role");await db.exec(await readFile("supabase/migrations/20261118050000_sarvam_knowledge.sql","utf8"));
    await asUser(db,user);
    const retained=(await db.query("select content,embedding,embedding_model from public.document_chunks where document_id=$1",[doc.id])).rows[0];
    assert.equal(retained.content,content);assert.equal(retained.embedding,null);assert.equal(retained.embedding_model,null);
    assert.equal((await db.query("select storage_path from public.project_documents where id=$1",[doc.id])).rows[0].storage_path,doc.storage_path);
    const search=async(question)=>(await db.query("select * from public.search_project_documents_text($1,$2,6)",[project,question])).rows;
    const result=await answerQuestion({question:"Which authentication tokens are used?"},{
      authorize:async()=>{},reserve:()=>rpc(db,"reserve_rag_question",[project]),rewrite:async(q)=>q,
      embed:async()=>assert.fail("Full-text mode must not call an embedding API"),search:async()=>assert.fail("Full-text mode must not use vector search"),
      searchText:search,answer:async()=>({supported:true,claims:[{text:"The project uses JWT authentication.",evidence:[{source:1,quote:content}]}]}),
      stillAvailable:async(ids)=>ids,
    });
    assert.equal(result.abstained,false);assert.equal(result.citations[0].document_id,doc.id);
    const missing=await answerQuestion({question:"What is the cafeteria menu?"},{authorize:async()=>{},reserve:async()=>{},rewrite:async(q)=>q,searchText:search,answer:async()=>assert.fail("No evidence must abstain without AI")});
    assert(missing.abstained);
    await asUser(db,outsider);assert.equal((await search("authentication")).length,0);
    await asUser(db,user);await rpc(db,"queue_document",[doc.id]);await asWorker(db);const retry=await rpc(db,"claim_document_job");
    await ingestDocument({mime_type:"text/plain",file_size:Buffer.byteLength(content)},{download:async()=>Buffer.from(content),cached:async()=>assert.fail("Full-text ingestion does not need an embedding cache"),embed:async()=>assert.fail("Full-text ingestion does not call AI"),finish:(chunks,hash)=>rpc(db,"finish_document_job",[retry.job.id,retry.job.lease_token,chunks,hash])});
    await asUser(db,user);assert.equal((await search("JWT")).length,1);
    await rpc(db,"delete_document",[doc.id]);assert.equal((await search("JWT")).length,0);
  }finally{await db.close();process.env=saved;}
});
