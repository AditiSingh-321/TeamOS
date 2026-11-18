import test from "node:test";
import assert from "node:assert/strict";
import { riskImpact,shouldClassify,verifiedClassification } from "../src/lib/intelligence/risk.ts";
import { analyzeRiskEvent } from "../src/lib/intelligence/process-risk.ts";
import { createDatabase,asUser,asWorker,rpc } from "./database.mjs";
const classification={state:"confirmed",blockerType:"external_dependency",reason:"Credentials missing",evidence:"Payment integration is blocked because vendor credentials are missing. We need three days.",reportedDelayDays:30,confidence:0.93,suggestedActions:["Contact the vendor"]};
const tasks=[{id:"a",project_id:"p",title:"Payment",status:"In Progress",priority:"High",due_date:"2026-11-17",is_blocked:false},{id:"b",project_id:"p",title:"Checkout",status:"To Do",priority:"Medium",due_date:"2026-11-22",is_blocked:false},{id:"c",project_id:"p",title:"Test",status:"Done",priority:"Low",due_date:null,is_blocked:false}];
const context={tasks,edges:[{source_id:"a",target_id:"b"},{source_id:"b",target_id:"c"}],project:{deadline:"2026-11-21"},risks:[]};
test("risk prefilters, exact evidence and reported delay avoid fabricated classification facts",()=>{
 assert(shouldClassify(classification.evidence));assert(!shouldClassify("Authentication completed successfully."));
 assert.equal(verifiedClassification(classification,classification.evidence).reportedDelayDays,3);
 assert.throws(()=>verifiedClassification({...classification,evidence:"invented"},classification.evidence),/evidence/);
 assert.equal(verifiedClassification({...classification,evidence:"Waiting for vendor"},"Waiting for vendor").reportedDelayDays,null);
});
test("risk impact reuses project DAG, excludes completed descendants, explains severity and fails safely on cycles",()=>{
 const result=riskImpact(tasks[0],context,true,"2026-11-18");assert.deepEqual(result.affected_task_ids,["b"]);assert.equal(result.severity,"Critical");assert(result.explanations.some(text=>text.includes("no project delay")));
 assert.throws(()=>riskImpact(tasks[0],{...context,edges:[...context.edges,{source_id:"c",target_id:"a"}]},true,"2026-11-18"),/cycle/);
 assert.throws(()=>riskImpact(tasks[0],{...context,tasks:[...tasks,{...tasks[1],id:"foreign",project_id:"q"}],edges:[{source_id:"a",target_id:"foreign"}]},true,"2026-11-18"),/unavailable|project/);
});
test("completed and historical resolved updates never create blocker classifications",async()=>{
 const event={id:"event",source_task_id:"a",kind:"comment",evidence:"Was blocked yesterday, now resolved."};
 assert.equal((await analyzeRiskEvent(event,context,async()=>assert.fail("Resolved update called AI"),"2026-11-18")).result.state,"resolved");
 assert.equal((await analyzeRiskEvent({...event,source_task_id:"c",evidence:classification.evidence},context,async()=>assert.fail("Done task called AI"),"2026-11-18")).result.state,"completed");
 assert.equal((await analyzeRiskEvent({...event,evidence:"Making good progress"},context,async()=>assert.fail("Minor update called AI"),"2026-11-18")).result,null);
});
test("blocker event to risk to graph impact to manager resolution is isolated and idempotent",async()=>{
 const db=await createDatabase();const owner="f8000000-0000-4000-8000-000000000001",outsider="f8000000-0000-4000-8000-000000000002";
 try{
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'riskowner@test.dev',now(),'{}'),($2,'outsider@test.dev',now(),'{}')",[owner,outsider]);await asUser(db,owner);
  const wid=await rpc(db,"create_workspace",["Risk workspace"]);const pid=(await db.query("insert into public.projects(workspace_id,name) values($1,'Payments') returning id",[wid])).rows[0].id;
  const a=(await db.query("insert into public.tasks(workspace_id,project_id,title,priority) values($1,$2,'Payment','High') returning id",[wid,pid])).rows[0].id;
  const b=(await db.query("insert into public.tasks(workspace_id,project_id,title) values($1,$2,'Checkout') returning id",[wid,pid])).rows[0].id;
  await rpc(db,"add_task_dependency",[wid,pid,a,b]);
  await db.query("insert into public.task_comments(workspace_id,task_id,body) values($1,$2,$3)",[wid,a,classification.evidence]);
  await asWorker(db);let createdRisk;
  for(let i=0;i<3;i++){
   const record=await rpc(db,"claim_intelligence_job");if(!record)break;
   const analysis=await analyzeRiskEvent(record.event,record.context,async()=>classification,new Date().toISOString().slice(0,10));
   assert(await rpc(db,"finish_risk_job",[record.job.id,record.job.lease_token,record.context,analysis.result,analysis.impacts]));
   assert.equal(await rpc(db,"finish_risk_job",[record.job.id,record.job.lease_token,record.context,analysis.result,analysis.impacts]),false);
  }
  await asUser(db,owner);let rows=(await db.query("select * from public.project_risks")).rows;assert.equal(rows.length,1);createdRisk=rows[0];assert.deepEqual(createdRisk.affected_task_ids,[b]);
  assert.equal((await rpc(db,"risk_summary",[wid,pid])).active,1);
  await db.query("insert into public.task_comments(workspace_id,task_id,body) values($1,$2,$3)",[wid,a,classification.evidence]);
  await asWorker(db);const repeated=await rpc(db,"claim_intelligence_job");const analysis=await analyzeRiskEvent(repeated.event,repeated.context,async()=>classification,new Date().toISOString().slice(0,10));await rpc(db,"finish_risk_job",[repeated.job.id,repeated.job.lease_token,repeated.context,analysis.result,analysis.impacts]);
  await asUser(db,outsider);assert.equal((await db.query("select * from public.project_risks")).rows.length,0);await assert.rejects(rpc(db,"review_risk",[createdRisk.id,"resolved",createdRisk.updated_at]),/access/);await assert.rejects(rpc(db,"claim_intelligence_job"),/permission/);
  await asUser(db,owner);rows=(await db.query("select * from public.project_risks")).rows;assert.equal(rows.length,1);await rpc(db,"review_risk",[rows[0].id,"acknowledged",rows[0].updated_at]);
  const current=(await db.query("select * from public.project_risks")).rows[0];await rpc(db,"review_risk",[current.id,"resolved",current.updated_at]);assert.equal((await rpc(db,"risk_summary",[wid,pid])).active,0);
  assert.equal((await db.query("select * from public.risk_history")).rows.length,3);
 }finally{await db.close();}
});
