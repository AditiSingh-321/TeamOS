import { z } from "zod";
import { collaborationUser,json,checkDatabase } from "@/lib/collaboration/server";
import { httpError } from "@/lib/knowledge/http";
import { KnowledgeError } from "@/lib/knowledge/validation";
export async function GET(request:Request){try{
 const {db,user}=await collaborationUser();const input=z.object({workspace:z.uuid().optional(),project:z.uuid().optional(),token:z.enum(["1"]).optional(),presence:z.enum(["1"]).optional()}).parse(Object.fromEntries(new URL(request.url).searchParams));
 const scopes=[`u:${user.id}`];let members:{user_id:string;display_name:string}[]=[];
 if(input.workspace){const {data:member}=await db.from("workspace_members").select("user_id").eq("workspace_id",input.workspace).eq("user_id",user.id).maybeSingle();if(!member)throw new KnowledgeError("Workspace access changed.",403);
 if(input.project){const {data:project}=await db.from("projects").select("id").eq("workspace_id",input.workspace).eq("id",input.project).maybeSingle();if(!project)throw new KnowledgeError("Project access changed.",403);scopes.push(`p:${input.project}`);if(input.presence){const roster=await db.from("workspace_members").select("user_id,display_name").eq("workspace_id",input.workspace).limit(1000);checkDatabase(roster.error);members=roster.data??[];}}else scopes.push(`w:${input.workspace}`);}
 const {data:signals,error}=await db.from("collaboration_signals").select("scope_key,event_id").in("scope_key",scopes);checkDatabase(error);
 let token:string|undefined;let expiresAt:number|undefined;
 if(input.token){const {data:{session}}=await db.auth.getSession();if(!session)throw new KnowledgeError("Sign in to continue.",401);token=session.access_token;expiresAt=session.expires_at;}
 return json({userId:user.id,scopes,signals:signals??[],token,expiresAt,members});
 }catch(e){return httpError(e);}}
