import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const enabled=process.env.TEAMOS_REALTIME_TEST==="1";
test("live Supabase: two isolated members receive task/comment/delete signals and recipient notifications",{skip:!enabled,timeout:90000},async()=>{
 const required=["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","REALTIME_TEST_PROJECT_ID","REALTIME_TEST_USER_A_EMAIL","REALTIME_TEST_USER_A_PASSWORD","REALTIME_TEST_USER_B_EMAIL","REALTIME_TEST_USER_B_PASSWORD"];
 for(const key of required)assert(process.env[key],`Missing ${key}`);
 const make=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const a=make(),b=make();let taskId;
 async function until(check,message){for(let i=0;i<40;i++){if(await check())return;await wait(500);}assert.fail(message);}
 try{
  const loginA=await a.auth.signInWithPassword({email:process.env.REALTIME_TEST_USER_A_EMAIL,password:process.env.REALTIME_TEST_USER_A_PASSWORD});const loginB=await b.auth.signInWithPassword({email:process.env.REALTIME_TEST_USER_B_EMAIL,password:process.env.REALTIME_TEST_USER_B_PASSWORD});assert(!loginA.error&&!loginB.error,"Test sign-in failed");
  const pid=process.env.REALTIME_TEST_PROJECT_ID;const {data:p,error}=await a.from("projects").select("id,workspace_id,name").eq("id",pid).single();assert(!error&&p?.name.startsWith("TEST Realtime"),"Refusing to modify a project not named TEST Realtime…");
  const {data:role}=await a.from("workspace_members").select("role").eq("workspace_id",p.workspace_id).eq("user_id",loginA.data.user.id).single();assert(["owner","admin"].includes(role?.role),"Test A must be manager");
  assert((await b.from("projects").select("id").eq("id",pid).single()).data,"Test B needs project access");
  await b.realtime.setAuth(loginB.data.session.access_token);
  let signals=0;const channel=b.channel(`sync:p:${pid}`,{config:{private:true}}).on("postgres_changes",{event:"*",schema:"public",table:"collaboration_signals",filter:`scope_key=eq.p:${pid}`},()=>{signals++;});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Realtime subscription timeout")),15000);channel.subscribe(status=>{if(status==="SUBSCRIBED"){clearTimeout(timer);resolve();}else if(status==="CHANNEL_ERROR"){clearTimeout(timer);reject(new Error("Realtime channel error"));}});});
  const created=await a.from("tasks").insert({workspace_id:p.workspace_id,project_id:pid,title:`Realtime test ${randomUUID()}`,assignee_id:loginB.data.user.id}).select("id,updated_at").single();assert(!created.error);taskId=created.data.id;
  await until(()=>signals>0,"Task creation signal missing");
  const notification=await b.from("notifications").select("id").eq("target_id",taskId).eq("type","assignment");assert.equal(notification.data?.length,1);
  let before=signals;const moved=await a.rpc("move_task",{target_workspace:p.workspace_id,target_task:taskId,expected_updated_at:created.data.updated_at,next_status:"Review"});assert(!moved.error&&moved.data);await until(()=>signals>before,"Status signal missing");assert.equal((await b.from("tasks").select("status").eq("id",taskId).single()).data.status,"Review");
  before=signals;const comment=await a.rpc("post_task_comment",{target_task:taskId,content:"Realtime test comment",mentioned_users:[loginB.data.user.id],request_id:randomUUID()});assert(!comment.error);await until(()=>signals>before,"Comment signal missing");assert.equal((await b.from("task_comments").select("id").eq("task_id",taskId)).data.length,1);
  before=signals;assert(!(await a.from("tasks").delete().eq("id",taskId)).error);await until(()=>signals>before,"Deletion signal missing");assert.equal((await b.from("tasks").select("id").eq("id",taskId)).data.length,0);taskId=undefined;
 }finally{if(taskId)await a.from("tasks").delete().eq("id",taskId);await Promise.all([a.removeAllChannels(),b.removeAllChannels()]);await Promise.all([a.auth.signOut(),b.auth.signOut()]);}
});
