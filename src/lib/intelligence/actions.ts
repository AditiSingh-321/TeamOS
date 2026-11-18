"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/supabase/server";
import { intelligenceRpc } from "./db";
export async function reviewRisk(_state: {error?:string;message?:string},form:FormData){
 await requireAuth();const db=await createAuthClient(true);if(!db)return{error:"Sign in again."};
 const input=z.object({id:z.uuid(),status:z.enum(["acknowledged","resolved","dismissed","reanalyze"]),version:z.string().min(1)}).safeParse(Object.fromEntries(form));
 if(!input.success)return{error:"Refresh and choose a valid risk action."};
 try{await intelligenceRpc(db,"review_risk",{target_risk:input.data.id,next_status:input.data.status,expected_updated_at:input.data.version});for(const path of ["/risks","/","/dependencies","/my-tasks"])revalidatePath(path);return{message:"Risk updated."};}catch(error){return{error:(error as Error).message};}
}
export async function flagTask(_state:{error?:string;message?:string},form:FormData){
 await requireAuth();const db=await createAuthClient(true);if(!db)return{error:"Sign in again."};
 const parsed=z.object({taskId:z.uuid(),version:z.string().min(1),blocked:z.enum(["true","false"])}).safeParse(Object.fromEntries(form));if(!parsed.success)return{error:"Reopen the task."};
 try{await intelligenceRpc(db,"set_task_blocked",{target_task:parsed.data.taskId,expected_updated_at:parsed.data.version,blocked:parsed.data.blocked==="true"});for(const path of ["/my-tasks","/dependencies","/risks"])revalidatePath(path);return{message:"Task blocker flag updated. Analysis is queued."};}catch(error){return{error:(error as Error).message};}
}

export async function retryIntelligence(_state:{error?:string;message?:string},form:FormData){
 await requireAuth();const db=await createAuthClient(true);const id=z.uuid().safeParse(form.get("projectId"));if(!db||!id.success)return{error:"Choose a valid project."};
 try{await intelligenceRpc(db,"retry_intelligence_jobs",{target_project:id.data});revalidatePath("/risks");revalidatePath("/meetings");return{message:"Failed analyses queued again."};}catch(error){return{error:(error as Error).message};}
}
