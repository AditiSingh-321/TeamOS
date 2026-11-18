import "server-only";
import { getWorkspaceContext } from "@/lib/workspaces/queries";
import { createAuthClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";
export interface RiskRecord { id:string;project_id:string;source_task_id:string|null;title:string;description:string;severity:string;status:string;confirmation:string;confidence:number|null;reported_delay_days:number|null;detected_at:string;updated_at:string;affected_task_ids:string[];evidence:{text:string;kind:string;meeting_id?:string|null};explanations:string[];recommendations:string[] }
export async function intelligenceScope(selected?:string){
 const [{active,error},profile,db]=await Promise.all([getWorkspaceContext(),requireAuth(),createAuthClient()]);
 const result=active&&db?await db.from("projects").select("id,name").eq("workspace_id",active.id).order("name").limit(100):null;
 const projects=result?.data??[];
 return {active,error:error??(result?.error?"Could not load projects.":null),profile,db,projects,project:projects.find((p)=>p.id===selected)??projects[0]};
}
export async function riskSummary(workspaceId:string,projectId?:string){
 const db=await createAuthClient();const {data,error}=db?await db.rpc("risk_summary",{target_workspace:workspaceId,target_project:projectId??null}):{data:null,error:true};
 return error?null:data as {active:number;high:number;blocked:number;affected:number;sources:string[];affected_ids:string[]};
}
