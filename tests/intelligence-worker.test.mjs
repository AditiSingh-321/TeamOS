import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("standalone intelligence worker consumes a leased blocker event without calling AI for an explicit flag",async()=>{
 const calls=[];
 const task={id:"fb000000-0000-4000-8000-000000000001",project_id:"fb000000-0000-4000-8000-000000000003",title:"Payment",status:"To Do",priority:"High",due_date:null,is_blocked:true};
 const server=createServer(async(req,res)=>{
  const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||"{}");calls.push({url:req.url,body});
  res.setHeader("Content-Type","application/json");
  if(req.url==="/rest/v1/rpc/scan_overdue_risks")res.end("null");
  else if(req.url==="/rest/v1/rpc/claim_intelligence_job")res.end(JSON.stringify({job:{id:"job",lease_token:"lease",kind:"risk_event",project_id:task.project_id},event:{id:"event",source_task_id:task.id,kind:"blocked_flag",evidence:"Flag set by a member"},context:{project:{deadline:null},tasks:[task,{...task,id:"fb000000-0000-4000-8000-000000000002",is_blocked:false}],edges:[{source_id:task.id,target_id:"fb000000-0000-4000-8000-000000000002"}],risks:[]}}));
  else if(req.url==="/rest/v1/rpc/finish_risk_job")res.end("true");
  else {res.statusCode=500;res.end("{}");}
 });
 server.listen(0,"127.0.0.1");await once(server,"listening");
 try{
  const child=spawn(process.execPath,["--conditions=react-server","--experimental-strip-types","--import","./scripts/register.mjs","scripts/intelligence-worker.mjs","--once"],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:"+server.address().port,SUPABASE_SERVICE_ROLE_KEY:"fake-worker-key",SARVAM_API_KEY:""},signal:AbortSignal.timeout(30000)});
  let output="";child.stdout.on("data",data=>output+=data);child.stderr.on("data",data=>output+=data);
  const [code]=await once(child,"close");assert.equal(code,0,output);assert.match(output,/Completed risk_event job/);
  assert.equal(calls.length,3);assert.equal(calls[2].body.result.state,"confirmed");assert.equal(calls[2].body.impacts[0].affected_task_ids.length,1);assert.equal(calls[2].body.token,"lease");
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
