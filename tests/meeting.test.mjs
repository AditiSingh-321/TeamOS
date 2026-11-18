import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase,asUser,asWorker,rpc } from "./database.mjs";
import { prepareMeetingAnalysis,matchingTask,meetingKnowledge,parseMeetingTranscript } from "../src/lib/intelligence/meeting.ts";
import { indexPassages } from "../src/lib/knowledge/ingestion.ts";
import { notes,analysis } from "./meeting-fixtures.mjs";

test("meeting extraction preserves quoted evidence, avoids invented dates/assignees and resolves only unique task titles",()=>{
 const review=prepareMeetingAnalysis(analysis,notes,[],[],[]);assert.equal(review.actionItems[0].dueDate,null);assert.equal(review.actionItems[0].assigneeId,null);assert.equal(review.actionItems[0].assigneeName,null);
 assert.equal(matchingTask("Authentication",[{id:"a",title:"Authentication"},{id:"b",title:"authentication"}]),null);
 assert.equal(matchingTask("  AUTHENTICATION ",[{id:"a",title:"Authentication"}]),"a");
 assert.throws(()=>prepareMeetingAnalysis({...analysis,decisions:[{description:"Invented",evidence:"Never said"}]},notes,[],[],[]),/evidence/);
 assert(!meetingKnowledge(review).some(row=>row.content.includes("Request credentials")));
 assert.match(parseMeetingTranscript("notes.md",Buffer.from(notes)),/PostgreSQL/);assert.throws(()=>parseMeetingTranscript("notes.exe",Buffer.from(notes)),/TXT/);assert.throws(()=>parseMeetingTranscript("notes.txt",Buffer.from("short")),/20/);
});
test("meeting creation, reviewed analysis, risk links and RAG indexing stay authorized and revision-safe",async()=>{
 const original=process.env.RAG_RETRIEVAL_MODE;process.env.RAG_RETRIEVAL_MODE="fulltext";
 const db=await createDatabase();const owner="f9000000-0000-4000-8000-000000000001",outsider="f9000000-0000-4000-8000-000000000002";
 try{
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'meetingowner@test.dev',now(),'{}'),($2,'outsider@test.dev',now(),'{}')",[owner,outsider]);await asUser(db,owner);
  const wid=await rpc(db,"create_workspace",["Meeting workspace"]);const pid=(await db.query("insert into public.projects(workspace_id,name) values($1,'Meeting project') returning id",[wid])).rows[0].id;
  const payment=(await db.query("insert into public.tasks(workspace_id,project_id,title) values($1,$2,'Payment integration') returning id,title",[wid,pid])).rows[0];
  const input={title:"Delivery review",meeting_date:"2026-11-18",participants:["Rahul"],transcript:notes};const mid=await rpc(db,"save_meeting",[pid,null,0,input]);
  const aid=await rpc(db,"queue_meeting_analysis",[mid,1]);assert.equal(await rpc(db,"queue_meeting_analysis",[mid,1]),aid);
  await asWorker(db);const job=await rpc(db,"claim_intelligence_job");assert.equal(job.job.kind,"meeting_analysis");
  const draft=prepareMeetingAnalysis(analysis,notes,["Rahul"],[payment],[]);assert.equal(draft.blockers[0].taskId,payment.id);
  assert(await rpc(db,"finish_meeting_analysis",[job.job.id,job.job.lease_token,draft]));
  await asUser(db,outsider);assert.equal((await db.query("select * from public.meetings")).rows.length,0);await assert.rejects(rpc(db,"save_reviewed_meeting",[aid,2,draft]),/access/);
  await asUser(db,owner);await assert.rejects(rpc(db,"save_reviewed_meeting",[aid,1,draft]),/changed/);
  await rpc(db,"save_reviewed_meeting",[aid,2,draft]);await assert.rejects(rpc(db,"save_reviewed_meeting",[aid,2,draft]),/changed/);
  assert.equal((await db.query("select count(*)::int as count from public.tasks")).rows[0].count,1);
  await asWorker(db);let indexed=false;
  for(let i=0;i<3;i++){
   const record=await rpc(db,"claim_intelligence_job");if(!record)break;
   if(record.job.kind==="meeting_index"){
    await indexPassages(meetingKnowledge(draft),{cached:async()=>[],embed:async()=>assert.fail("Default meeting index must not call embeddings"),finish:(chunks)=>rpc(db,"finish_meeting_index",[record.job.id,record.job.lease_token,record.analysis.revision,chunks])},"meeting");indexed=true;
   }else{await rpc(db,"finish_risk_job",[record.job.id,record.job.lease_token,record.context,null,[]]);}
  }
  assert(indexed);await asUser(db,owner);
  const matches=(await db.query("select * from public.search_project_documents_text($1,'PostgreSQL',6)",[pid])).rows;assert.equal(matches[0].meeting_id,mid);assert.equal(matches[0].document_id,null);
  assert.equal((await db.query("select count(*)::int as count from public.project_risk_events where kind='meeting'")).rows[0].count,1);
  await rpc(db,"save_reviewed_meeting",[aid,3,draft]);assert.equal((await db.query("select count(*)::int as count from public.project_risk_events where kind='meeting'")).rows[0].count,1);
  await rpc(db,"save_meeting",[pid,mid,1,{...input,title:"Edited notes"}]);assert.equal((await db.query("select * from public.search_project_documents_text($1,'PostgreSQL',6)",[pid])).rows.length,0);
  assert.equal((await db.query("select source_snapshot->>'transcript' as text from public.meeting_analyses where id=$1",[aid])).rows[0].text,notes);
  await rpc(db,"delete_meeting",[mid,2]);assert.equal((await db.query("select * from public.meetings")).rows.length,0);
 }finally{await db.close();if(original===undefined)delete process.env.RAG_RETRIEVAL_MODE;else process.env.RAG_RETRIEVAL_MODE=original;}
});
