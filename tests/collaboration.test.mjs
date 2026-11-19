import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createDatabase,asUser,asWorker,rpc } from "./database.mjs";
import { createInvalidator,signalVersion } from "../src/lib/collaboration/sync.ts";

test("repeated/out-of-order signals coalesce; reconnect refetches authoritative state; dispose cancels work",async()=>{
 let current=[{id:"task",status:"To Do"}],a=[],b=[],aCalls=0,bCalls=0;
 const first=createInvalidator(()=>{a=structuredClone(current);aCalls++;},5),second=createInvalidator(()=>{b=structuredClone(current);bCalls++;},5);
 current=[{id:"task",status:"Review"}];for(const client of [first,second]){client.event("project","new");client.event("project","new");client.event("project","old");}
 await wait(20);assert.deepEqual(a,current);assert.deepEqual(b,current);assert.equal(aCalls,1);assert.equal(bCalls,1);
 current=[];second.event("project","deleted");await wait(20);assert.deepEqual(b,[]);
 current=[{id:"missed-offline",status:"Done"}];second.reconnect();await wait(20);assert.deepEqual(b,current);
 first.reconnect();first.dispose();await wait(20);assert.equal(aCalls,1);second.dispose();
 assert.equal(signalVersion(["b","a"],[{scope_key:"b",event_id:"2"}]),signalVersion(["a","b"],[{scope_key:"b",event_id:"2"}]));
});

test("transactional collaboration records, notification recipients, reminders, access revocation and private Presence",async t=>{
 const db=await createDatabase();const owner=randomUUID(),member=randomUUID(),outsider=randomUUID();let wid,pid,taskId;
 try{
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'owner@collab.test',now(),'{}'),($2,'member@collab.test',now(),'{}'),($3,'outsider@collab.test',now(),'{}')",[owner,member,outsider]);
  await asUser(db,owner);wid=await rpc(db,"create_workspace",["Collaboration tests"]);
  await db.exec("reset role");await db.query("insert into public.workspace_members(workspace_id,user_id,display_name) values($1,$2,'Member')",[wid,member]);await asUser(db,owner);
  pid=(await db.query("insert into public.projects(workspace_id,name) values($1,'Test project') returning id",[wid])).rows[0].id;
  const otherPid=(await db.query("insert into public.projects(workspace_id,name) values($1,'Other project') returning id",[wid])).rows[0].id;
  assert(otherPid!==pid);const oldVersion=(await db.query("select event_id from public.collaboration_signals where scope_key=$1",['w:'+wid])).rows[0].event_id;await db.query("delete from public.projects where id=$1",[otherPid]);assert.notEqual((await db.query("select event_id from public.collaboration_signals where scope_key=$1",['w:'+wid])).rows[0].event_id,oldVersion);
  await t.test("task assignment, stale status conflict and scoped signals derive from committed changes",async()=>{
   const task=(await db.query("insert into public.tasks(workspace_id,project_id,title,assignee_id) values($1,$2,'Payment API',$3) returning *",[wid,pid,member])).rows[0];taskId=task.id;
   assert.equal((await db.query("select count(*)::int n from public.project_activity_events where event_type='task_created'")).rows[0].n,1);
   const version=(await db.query("select event_id from public.collaboration_signals where scope_key=$1",['p:'+pid])).rows[0].event_id;
   const moved=await rpc(db,"move_task",[wid,taskId,task.updated_at,"Review"]);assert(moved);
   assert.equal(await rpc(db,"move_task",[wid,taskId,task.updated_at,"Done"]),null);
   assert.notEqual((await db.query("select event_id from public.collaboration_signals where scope_key=$1",['p:'+pid])).rows[0].event_id,version);
   await asUser(db,member);const notifications=(await db.query("select * from public.notifications")).rows;assert.equal(notifications.length,1);assert.equal(notifications[0].type,"assignment");assert.equal(notifications[0].target_id,taskId);
   await asUser(db,owner);assert.equal((await db.query("select * from public.notifications")).rows.length,0);
  });
  await t.test("structured mentions validate users and retries do not duplicate comments or notifications",async()=>{
   const request=randomUUID();const cid=await rpc(db,"post_task_comment",[taskId,"Please review @arbitrary-text",[member],request]);assert.equal(await rpc(db,"post_task_comment",[taskId,"Please review @arbitrary-text",[member],request]),cid);
   assert.equal((await db.query("select count(*)::int n from public.task_comments where id=$1",[cid])).rows[0].n,1);
   await assert.rejects(rpc(db,"post_task_comment",[taskId,"Mention outsider",[outsider],randomUUID()]),/Invalid/);
   await asUser(db,member);assert.equal((await db.query("select * from public.notifications where type='mention'")).rows.length,1);
   assert.equal(await rpc(db,"mark_notifications_read",[null]),2);assert.equal(await rpc(db,"mark_notifications_read",[null]),0);
   assert.equal((await db.query("select count(*)::int n from public.notifications where read_at is null")).rows[0].n,0);
   await db.query("insert into public.notification_preferences(user_id,mentions,reminders) values($1,false,false)",[member]);
   await asUser(db,owner);await rpc(db,"post_task_comment",[taskId,"No mention notification",[member],randomUUID()]);
   await asUser(db,member);assert.equal((await db.query("select * from public.notifications where type='mention'")).rows.length,1);await db.query("update public.notification_preferences set reminders=true where user_id=$1",[member]);await asUser(db,owner);
  });
  await t.test("UTC due-soon/overdue scans have stable deduplication and respect Done and preferences",async()=>{
   await db.query("update public.tasks set due_date=(now() at time zone 'UTC')::date+1 where id=$1",[taskId]);await asWorker(db);assert.equal(await rpc(db,"scan_task_reminders",[1]),1);assert.equal(await rpc(db,"scan_task_reminders",[1]),0);
   await asUser(db,member);assert.equal((await db.query("select * from public.notifications where type='due_soon'")).rows.length,1);
   await asUser(db,owner);await db.query("update public.tasks set due_date=(now() at time zone 'UTC')::date-1 where id=$1",[taskId]);await asWorker(db);assert.equal(await rpc(db,"scan_task_reminders",[1]),1);assert.equal(await rpc(db,"scan_task_reminders",[1]),0);
   await asUser(db,member);const n=(await db.query("select * from public.notifications where type='overdue'")).rows[0];assert(n);assert.equal(await rpc(db,"mark_notifications_read",[n.id]),1);
   await asUser(db,owner);
  });
  await t.test("activity pagination is stable and mutation rollback emits no durable event",async()=>{
   const before=(await db.query("select count(*)::int n from public.project_activity_events")).rows[0].n;
   await db.exec("begin");await db.query("update public.tasks set priority='High' where id=$1",[taskId]);await db.exec("rollback");assert.equal((await db.query("select count(*)::int n from public.project_activity_events")).rows[0].n,before);
   const pages=await Promise.all([0,3].map(offset=>db.query("select id from public.project_activity_events where project_id=$1 order by created_at desc,id desc limit 3 offset $2",[pid,offset])));assert.equal(new Set(pages.flatMap(r=>r.rows.map(row=>row.id))).size,pages.reduce((n,r)=>n+r.rows.length,0));
   await assert.rejects(db.query("insert into public.project_activity_events(workspace_id,actor_name,event_type,target_type,summary,source_key) values($1,'Fake','fake','task','Fake','fake')",[wid]),/permission/);
   await assert.rejects(db.query("update public.collaboration_signals set event_id=gen_random_uuid()"),/permission/);
   await assert.rejects(db.query("insert into public.notifications(recipient_user_id,workspace_id,event_id,type,title,body,target_type) values($1,$2,gen_random_uuid(),'mention','Fake','Fake','task')",[member,wid]),/permission/);
  });
  await t.test("private Presence allows only current project members and forbids Broadcast publication",async()=>{
   await db.query("select set_config('realtime.topic',$1,false)",['project:'+pid]);assert.equal(await rpc(db,"can_view_project_presence",['project:'+pid]),true);assert.equal(await rpc(db,"can_read_collaboration_channel",['sync:p:'+pid]),true);assert.equal(await rpc(db,"can_read_collaboration_channel",['sync:u:'+member]),false);
   await db.query("insert into realtime.messages(extension,topic) values('presence',$1)",['project:'+pid]);
   await assert.rejects(db.query("insert into realtime.messages(extension,topic) values('broadcast',$1)",['project:'+pid]),/row-level security/);
   await asUser(db,outsider);assert.equal(await rpc(db,"can_view_project_presence",['project:'+pid]),false);assert.equal(await rpc(db,"can_read_collaboration_channel",['sync:p:'+pid]),false);assert.equal((await db.query("select * from realtime.messages")).rows.length,0);
   await assert.rejects(db.query("insert into realtime.messages(extension,topic) values('presence',$1)",['project:'+pid]),/row-level security/);
   assert.equal((await db.query("select * from public.project_activity_events")).rows.length,0);assert.equal((await db.query("select * from public.collaboration_signals")).rows.length,0);assert.equal((await db.query("select * from public.notifications")).rows.length,0);
   await asUser(db,owner);
  });
  await t.test("task deletion signals remain readable without deleted row payloads; revoked recipients lose reads",async()=>{
   const signal=(await db.query("select event_id from public.collaboration_signals where scope_key=$1",['p:'+pid])).rows[0].event_id;
   await db.query("delete from public.tasks where id=$1",[taskId]);assert.notEqual((await db.query("select event_id from public.collaboration_signals where scope_key=$1",['p:'+pid])).rows[0].event_id,signal);
   await db.exec("reset role");await db.query("delete from public.workspace_members where workspace_id=$1 and user_id=$2",[wid,member]);await asUser(db,member);
   assert.equal((await db.query("select * from public.notifications")).rows.length,0);assert.equal((await db.query("select * from public.project_activity_events")).rows.length,0);assert.equal((await db.query("select * from public.collaboration_signals where workspace_id=$1",[wid])).rows.length,0);assert.equal(await rpc(db,"can_view_project_presence",['project:'+pid]),false);assert.equal(await rpc(db,"can_read_collaboration_channel",['sync:p:'+pid]),false);await asUser(db,owner);
  });
 }finally{await db.close();}
});
