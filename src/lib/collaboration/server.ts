import "server-only";
import { z } from "zod";
import { createAuthClient } from "@/lib/supabase/server";
import { KnowledgeError } from "@/lib/knowledge/validation";
export const pageInput=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),unread:z.enum(["1","0"]).optional()});
export async function collaborationUser(){
 const db=await createAuthClient(true);if(!db)throw new KnowledgeError("Sign in to continue.",401);
 const {data:{user},error}=await db.auth.getUser();if(error||!user)throw new KnowledgeError("Sign in to continue.",401);
 return {db,user};
}
export function checkDatabase(error:{code?:string}|null){if(error)throw new KnowledgeError(["42P01","PGRST205","PGRST202"].includes(error.code??"")?"Apply the Phase 11 Supabase migration.":"The collaboration request failed. Please retry.",503);}
export function json(data:unknown){return Response.json(data,{headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});}
export async function notificationList(db:Awaited<ReturnType<typeof collaborationUser>>["db"],userId:string,page=1,unread=false){
 let query=db.from("notifications").select("id,workspace_id,project_id,type,title,body,target_type,target_id,created_at,read_at",{count:"exact"}).eq("recipient_user_id",userId);
 if(unread)query=query.is("read_at",null);
 const {data,error,count}=await query.order("created_at",{ascending:false}).order("id",{ascending:false}).range((page-1)*20,page*20-1);checkDatabase(error);return {rows:data??[],count:count??0,page};
}
