import test from "node:test";
import assert from "node:assert/strict";
import { actionSchema,actionRegistry,validateActionReferences,isActionRequest,isOverdueTaskQuestion } from "../src/lib/intelligence/registry.ts";
import { createDatabase,asUser,asWorker,rpc } from "./database.mjs";
import { notes,analysis } from "./meeting-fixtures.mjs";
import { prepareMeetingAnalysis } from "../src/lib/intelligence/meeting.ts";
import { analyzeRiskEvent } from "../src/lib/intelligence/process-risk.ts";

test("typed registry rejects unsafe tools, unknown fields and foreign references",()=>{
 assert.equal(Object.keys(actionRegistry).length,6);
 assert(!actionSchema.safeParse({type:"DELETE_PROJECT",payload:{}}).success);
 assert(!actionSchema.safeParse({type:"CREATE_TASK",payload:{title:"x",description:"",priority:"Low",assignee_id:null,due_date:null,sql:"delete"}}).success);
 assert(isOverdueTaskQuestion("What tasks are overdue?"));assert(!isOverdueTaskQuestion("Create tasks for overdue work"));
 assert(!isActionRequest("What tasks are overdue?"));assert(isActionRequest("Move authentication to Review"));
 const action={type:"UPDATE_TASK_STATUS",payload:{taskId:"fa000000-0000-4000-8000-000000000001",status:"Review"}};
 assert.throws(()=>validateActionReferences(action,[],[]),/selected project/);
 assert(actionSchema.safeParse({type:"ADD_TASK_COMMENT",payload:{taskId:action.payload.taskId,body:"Long comment ".repeat(30)}}).success);
});
test("approval engine executes scoped handlers, detects stale writes, logs failures and prevents duplicates",async(t)=>{
 const db=await createDatabase();const owner="fa000000-0000-4000-8000-000000000001",member="fa000000-0000-4000-8000-000000000002",outsider="fa000000-0000-4000-8000-000000000003";
 let wid,pid,tid,otherProject;
 async function propose(action){const request=crypto.randomUUID();const reserved=await rpc(db,"reserve_action_request",[pid,request,"Create a reviewed project change"]);const result=await rpc(db,"finish_action_request",[request,reserved.token,[{action,reason:"Explicit request for review"}]]);return result.proposalIds[0];}
 const current=async(id)=>(await db.query("select * from public.action_proposals where id=$1",[id])).rows[0];
 async function resetBudget(){await db.exec("reset role;delete from private.rag_requests;");await asUser(db,owner);}
 try{
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'approval-owner@test.dev',now(),'{}'),($2,'approval-member@test.dev',now(),'{}'),($3,'approval-outsider@test.dev',now(),'{}')",[owner,member,outsider]);await asUser(db,owner);
  wid=await rpc(db,"create_workspace",["Approval workspace"]);pid=(await db.query("insert into public.projects(workspace_id,name) values($1,'Approval project') returning id",[wid])).rows[0].id;
  otherProject=(await db.query("insert into public.projects(workspace_id,name) values($1,'Other') returning id",[wid])).rows[0].id;
  tid=(await db.query("insert into public.tasks(workspace_id,project_id,title) values($1,$2,'Authentication') returning id",[wid,pid])).rows[0].id;
  await db.exec("reset role");await db.query("insert into public.workspace_members(workspace_id,user_id,role,display_name) values($1,$2,'member','Rahul')",[wid,member]);await asUser(db,owner);
  await t.test("member proposal needs manager approval; repeated concurrent requests create one task",async()=>{
   await asUser(db,member);const id=await propose({type:"CREATE_TASK",payload:{title:"Approved follow-up",description:"Contact provider",priority:"High",due_date:null,assignee_id:member}});
   await assert.rejects(rpc(db,"review_action_proposal",[id,1,"approve"]),/Manager/);
   await asUser(db,owner);assert.equal((await db.query("select * from public.notifications where type='approval_pending'")).rows.length,1);const results=await Promise.all([rpc(db,"review_action_proposal",[id,1,"approve"]),rpc(db,"review_action_proposal",[id,1,"approve"])]);
   assert(results.every(result=>result.status==="executed"));assert.equal((await db.query("select count(*)::int as n from public.tasks where title='Approved follow-up'")).rows[0].n,1);
   assert.equal((await db.query("select count(*)::int as n from public.action_execution_logs where proposal_id=$1 and outcome='executed'",[id])).rows[0].n,1);
   await asUser(db,member);assert.equal((await db.query("select * from public.notifications where type='action_executed'")).rows.length,1);await asUser(db,outsider);assert.equal((await db.query("select * from public.action_proposals")).rows.length,0);await assert.rejects(rpc(db,"review_action_proposal",[id,1,"approve"]),/Manager/);await asUser(db,owner);
  });
  await t.test("status, priority, due date, assignment and comment handlers update existing task data",async()=>{
   await resetBudget();
   for(const action of [{type:"UPDATE_TASK_STATUS",payload:{taskId:tid,status:"Review"}},{type:"UPDATE_TASK_PRIORITY",payload:{taskId:tid,priority:"High"}},{type:"UPDATE_TASK_DUE_DATE",payload:{taskId:tid,due_date:"2026-12-18"}},{type:"ASSIGN_TASK",payload:{taskId:tid,assignee_id:member}},{type:"ADD_TASK_COMMENT",payload:{taskId:tid,body:"Reviewed project update"}}]){
    const id=await propose(action);assert.equal((await rpc(db,"review_action_proposal",[id,1,"approve"])).status,"executed");
   }
   const task=(await db.query("select * from public.tasks where id=$1",[tid])).rows[0];assert.equal(task.status,"Review");assert.equal(task.priority,"High");assert.equal(new Date(task.due_date).toISOString().slice(0,10),"2026-12-18");assert.equal(task.assignee_id,member);assert.equal((await db.query("select count(*)::int as n from public.task_comments where task_id=$1",[tid])).rows[0].n,1);
  });
  await t.test("stale update fails atomically, is auditable, and requires a reviewed edit",async()=>{
   await resetBudget();const id=await propose({type:"UPDATE_TASK_STATUS",payload:{taskId:tid,status:"In Progress"}});await db.query("update public.tasks set status='Done' where id=$1",[tid]);
   const result=await rpc(db,"review_action_proposal",[id,1,"approve"]);assert.equal(result.status,"failed");assert.match(result.error,/changed/);assert.equal((await db.query("select status from public.tasks where id=$1",[tid])).rows[0].status,"Done");
   const failed=await current(id);await rpc(db,"edit_action_proposal",[id,failed.revision,{taskId:tid,status:"Review"}]);const edited=await current(id);assert.equal((await rpc(db,"review_action_proposal",[id,edited.revision,"approve"])).status,"executed");
   const logs=(await db.query("select outcome from public.action_execution_logs where proposal_id=$1",[id])).rows.map(row=>row.outcome);assert(logs.includes("failed")&&logs.includes("edited")&&logs.includes("executed"));
   await assert.rejects(db.query("delete from public.action_execution_logs"),/permission/);
  });
  await t.test("foreign references, unsafe actions, rejected actions and failed inserts cannot mutate tasks",async()=>{
   await resetBudget();const foreign=(await db.query("insert into public.tasks(workspace_id,project_id,title) values($1,$2,'Other project') returning id",[wid,otherProject])).rows[0].id;
   await assert.rejects(propose({type:"UPDATE_TASK_STATUS",payload:{taskId:foreign,status:"Done"}}),/outside project/);
   await assert.rejects(propose({type:"DELETE_WORKSPACE",payload:{}}),/Unsupported/);
   const rejected=await propose({type:"UPDATE_TASK_PRIORITY",payload:{taskId:tid,priority:"Low"}});await rpc(db,"review_action_proposal",[rejected,1,"reject"]);await assert.rejects(rpc(db,"review_action_proposal",[rejected,2,"approve"]),/changed/);
   const id=await propose({type:"CREATE_TASK",payload:{title:"Force failed execution",description:"Test",priority:"Low",due_date:null,assignee_id:null}});
   await db.exec("reset role;alter table public.tasks add constraint fail_test_task check(title<>'Force failed execution');");await asUser(db,owner);
   assert.equal((await rpc(db,"review_action_proposal",[id,1,"approve"])).status,"failed");assert.equal((await db.query("select * from public.tasks where title='Force failed execution'")).rows.length,0);
  });
  await t.test("blocker comment -> risk -> follow-up -> approval creates one task and retains evidence",async()=>{
   await resetBudget();const body="Payment integration is blocked because vendor credentials are missing.";
   const payment=(await db.query("insert into public.tasks(workspace_id,project_id,title,assignee_id) values($1,$2,'Payment integration',$3) returning id",[wid,pid,member])).rows[0].id;
   await rpc(db,"add_task_dependency",[wid,pid,payment,tid]);await db.query("insert into public.task_comments(workspace_id,task_id,body) values($1,$2,$3)",[wid,payment,body]);
   await asWorker(db);
   for(let i=0;i<20;i++){const record=await rpc(db,"claim_intelligence_job");if(!record)break;const result=await analyzeRiskEvent(record.event,record.context,async()=>({state:"confirmed",blockerType:"external_dependency",reason:"Missing credentials",evidence:body,reportedDelayDays:null,confidence:0.9,suggestedActions:["Contact the provider"]}),new Date().toISOString().slice(0,10));await rpc(db,"finish_risk_job",[record.job.id,record.job.lease_token,record.context,result.result,result.impacts]);}
   await asUser(db,owner);const risk=(await db.query("select * from public.project_risks where source_task_id=$1",[payment])).rows[0];assert(risk);assert(risk.affected_task_ids.includes(tid));await asUser(db,member);assert.equal((await db.query("select * from public.notifications where type='risk'")).rows.length,1);await asUser(db,owner);
   const id=await rpc(db,"propose_risk_followup",[risk.id]);assert.equal(await rpc(db,"propose_risk_followup",[risk.id]),id);const result=await rpc(db,"review_action_proposal",[id,1,"approve"]);assert.equal(result.status,"executed");assert.equal(await rpc(db,"propose_risk_followup",[risk.id]),id);
   assert.equal((await db.query("select source_snapshot->'evidence'->>'text' as text from public.action_proposals where id=$1",[id])).rows[0].text,body);
   assert.equal((await db.query("select status from public.tasks where id=$1",[result.result.task_id])).rows[0].status,"To Do");
  });
  await t.test("meeting -> review -> proposals -> approval is duplicate-safe and source edits invalidate pending actions",async()=>{
   await resetBudget();const mid=await rpc(db,"save_meeting",[pid,null,0,{title:"Delivery sync",meeting_date:"2026-11-18",participants:["Rahul"],transcript:notes}]);const aid=await rpc(db,"queue_meeting_analysis",[mid,1]);
   await db.exec("reset role;update private.intelligence_jobs set state='done' where kind='risk_event' and state='queued'");await asWorker(db);const record=await rpc(db,"claim_intelligence_job");assert.equal(record.job.kind,"meeting_analysis");
   const draft=prepareMeetingAnalysis(analysis,notes,["Rahul"],[],[{user_id:member,display_name:"Rahul"}]);draft.blockers=[];draft.taskUpdates=[];await rpc(db,"finish_meeting_analysis",[record.job.id,record.job.lease_token,draft]);await asUser(db,owner);await rpc(db,"save_reviewed_meeting",[aid,2,draft]);
   const ids=await rpc(db,"propose_meeting_actions",[aid,3]);assert.equal(ids.length,1);assert.deepEqual(await rpc(db,"propose_meeting_actions",[aid,3]),ids);
   const result=await rpc(db,"review_action_proposal",[ids[0],1,"approve"]);assert.equal(result.status,"executed");await asUser(db,member);assert.equal((await db.query("select * from public.notifications where type='meeting_action'")).rows.length,1);await asUser(db,owner);assert.equal((await db.query("select count(*)::int as n from public.tasks where title='Contact payment provider'")).rows[0].n,1);assert.deepEqual(await rpc(db,"propose_meeting_actions",[aid,3]),ids);
   const edited={...draft,actionItems:[{...draft.actionItems[0],title:"Second meeting action",evidence:"We decided to use PostgreSQL."}]};await rpc(db,"save_reviewed_meeting",[aid,3,edited]);const pending=(await rpc(db,"propose_meeting_actions",[aid,4]))[0];
   await rpc(db,"save_meeting",[pid,mid,1,{title:"Changed",meeting_date:"2026-11-18",participants:[],transcript:notes+" Additional notes."}]);assert.equal((await rpc(db,"review_action_proposal",[pending,1,"approve"])).status,"failed");
  });
 }finally{await db.close();}
});
