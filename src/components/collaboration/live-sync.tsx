"use client";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useEffect,useState } from "react";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { createInvalidator,signalVersion } from "@/lib/collaboration/sync";
export function LiveSync({workspaceId,userId}:{workspaceId?:string;userId:string}){
 const router=useRouter();const pathname=usePathname();const params=useSearchParams();
 const candidate=params.get("project")??(/^\/projects\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname)?.[1]);
 const project=candidate&&/^[0-9a-f-]{36}$/i.test(candidate)?candidate:undefined;
 const [status,setStatus]=useState("Connecting");
 useEffect(()=>{
  let stopped=false;let checking=false;let version:string|undefined;let expires=0;let channel:RealtimeChannel|undefined;let retryAt=0;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return;
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{params:{eventsPerSecond:5}}});
  const invalidator=createInvalidator(()=>{window.dispatchEvent(new Event("teamos:sync"));router.refresh();});
  async function connect(){
   if(stopped||checking)return;checking=true;
   try{
    const tokenNeeded=!channel||Date.now()/1000>expires-90;
    const query=new URLSearchParams();if(workspaceId)query.set("workspace",workspaceId);if(project&&workspaceId)query.set("project",project);if(tokenNeeded)query.set("token","1");
    const response=await fetch(`/api/collaboration/session?${query}`,{cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(stopped)return;
    if(response.status===401||response.status===403){if(channel)await db.removeChannel(channel);channel=undefined;setStatus("Access changed");window.dispatchEvent(new Event("teamos:access-changed"));router.refresh();if(response.status===401)router.replace("/login");return;}
    const data=await response.json();if(stopped)return;if(!response.ok)throw new Error(data.error);
    if(data.userId!==userId){if(channel)await db.removeChannel(channel);channel=undefined;window.dispatchEvent(new Event("teamos:access-changed"));router.refresh();return;}
    const next=signalVersion(data.scopes,data.signals);if(version!==undefined&&version!==next)invalidator.reconnect();version=next;
    if(data.token){await db.realtime.setAuth(data.token);expires=data.expiresAt??0;}
    if(stopped)return;
    if(!channel){
     const scopes:string[]=data.scopes;channel=db.channel(`sync:${project?`p:${project}`:workspaceId?`w:${workspaceId}`:`u:${userId}`}`,{config:{private:true}});
     for(const scope of scopes)channel.on("postgres_changes",{event:"*",schema:"public",table:"collaboration_signals",filter:`scope_key=eq.${scope}`},payload=>{
      const record=payload.new as {scope_key?:string;event_id?:string};if(record.scope_key===scope&&typeof record.event_id==="string")invalidator.event(scope,record.event_id);
     });
     channel.subscribe(state=>{if(stopped)return;if(state==="SUBSCRIBED"){setStatus("Live");invalidator.reconnect();}else if(state==="CHANNEL_ERROR"||state==="TIMED_OUT"||state==="CLOSED"){setStatus("Reconnecting");retryAt=Date.now()+5000;}});
    }else if(retryAt&&Date.now()>retryAt){const previous=channel;channel=undefined;retryAt=0;await db.removeChannel(previous);}
   }catch{if(!stopped)setStatus(navigator.onLine?"Sync unavailable · retrying":"Offline");}finally{checking=false;}
  }
  function offline(){setStatus("Offline");}function online(){invalidator.reconnect();void connect();}function visible(){if(document.visibilityState==="visible")online();}
  void connect();const timer=setInterval(()=>{void connect();},15000);
  window.addEventListener("online",online);window.addEventListener("offline",offline);document.addEventListener("visibilitychange",visible);
  return()=>{stopped=true;clearInterval(timer);invalidator.dispose();window.removeEventListener("online",online);window.removeEventListener("offline",offline);document.removeEventListener("visibilitychange",visible);void db.removeAllChannels();};
 },[workspaceId,userId,project,router]);
 return <span role="status" title="Committed changes are fetched securely; connection checks run every 15 seconds." className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:inline-flex"><span className={`size-1.5 rounded-full ${status==="Live"?"bg-emerald-500":"bg-amber-500"}`} />{status}</span>;
}
