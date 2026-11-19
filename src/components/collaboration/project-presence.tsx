"use client";
import { createClient } from "@supabase/supabase-js";
import { useEffect,useState } from "react";
export function ProjectPresence({workspaceId,projectId}:{workspaceId:string;projectId:string}){
 const [viewers,setViewers]=useState<{user_id:string;display_name:string}[]>([]),[status,setStatus]=useState("Connecting viewers…");
 useEffect(()=>{
  let stopped=false;let busy=false;let cleanup=()=>{};
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)return;
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  async function join(){if(stopped||busy)return;busy=true;try{
   const response=await fetch(`/api/collaboration/session?workspace=${workspaceId}&project=${projectId}&token=1&presence=1`,{cache:"no-store",signal:AbortSignal.timeout(10000)});if(stopped)return;
   if(!response.ok)throw new Error("Presence unavailable");const data=await response.json();if(stopped)return;
   cleanup();await db.removeAllChannels();if(stopped)return;await db.realtime.setAuth(data.token);if(stopped)return;
   const userId=(data.scopes as string[]).find(s=>s.startsWith("u:"))?.slice(2);if(!userId)return;
   const channel=db.channel(`project:${projectId}`,{config:{private:true,presence:{key:userId}}});
   const roster=data.members as {user_id:string;display_name:string}[];
   function sync(){if(stopped)return;const state=channel.presenceState();setViewers(roster.filter(m=>Object.hasOwn(state,m.user_id)));}
   channel.on("presence",{event:"sync"},sync).subscribe(async state=>{if(stopped)return;if(state==="SUBSCRIBED"){setStatus("Connected viewers");await channel.track({connected:true});}else if(state==="CHANNEL_ERROR"||state==="TIMED_OUT"){setViewers([]);setStatus("Viewers unavailable");}});
   cleanup=()=>{void channel.untrack();};
  }catch{if(!stopped){cleanup();await db.removeAllChannels();setViewers([]);setStatus("Viewers unavailable");}}finally{busy=false;}}
  void join();const timer=setInterval(()=>{void join();},30000);const online=()=>{void join();};const offline=()=>{setViewers([]);setStatus("Viewers offline");cleanup();void db.removeAllChannels();};window.addEventListener("online",online);window.addEventListener("offline",offline);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener("online",online);window.removeEventListener("offline",offline);cleanup();void db.removeAllChannels();};
 },[workspaceId,projectId]);
 return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Project viewers"><div className="flex -space-x-1.5">{viewers.slice(0,5).map(v=><span key={v.user_id} title={v.display_name} className="grid size-7 place-items-center rounded-full border-2 border-white bg-violet-100 text-[10px] font-medium text-violet-800">{v.display_name.slice(0,1).toUpperCase()}</span>)}</div><span>{viewers.length?`${viewers.length} ${viewers.length===1?"member":"members"} connected to this project`:status}</span><span className="sr-only">Connection presence is advisory and does not indicate active work.</span></div>;
}
