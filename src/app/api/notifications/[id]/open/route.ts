import { z } from "zod";
import { cookies } from "next/headers";
import { collaborationUser,json,checkDatabase } from "@/lib/collaboration/server";
import { httpError,assertSameOrigin } from "@/lib/knowledge/http";
import { KnowledgeError } from "@/lib/knowledge/validation";
import { activeWorkspaceCookie } from "@/lib/workspaces/queries";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 assertSameOrigin(request);const id=z.uuid().parse((await params).id);const {db,user}=await collaborationUser();
 const {data:n,error}=await db.from("notifications").select("workspace_id,project_id,target_type,target_id").eq("recipient_user_id",user.id).eq("id",id).maybeSingle();checkDatabase(error);if(!n)throw new KnowledgeError("Notification unavailable.",404);
 const tables:Record<string,string>={task:"tasks",risk:"project_risks",meeting:"meetings",approval:"action_proposals",project:"projects",document:"project_documents"};const table=tables[n.target_type];
 if(!table||!n.target_id)throw new KnowledgeError("This resource is no longer available.",404);
 let q=db.from(table).select("id").eq("workspace_id",n.workspace_id).eq("id",n.target_id);if(n.project_id&&table!=="projects")q=q.eq("project_id",n.project_id);
 const {data:target,error:targetError}=await q.maybeSingle();checkDatabase(targetError);if(!target)throw new KnowledgeError("This resource is no longer available.",404);
 const href=n.target_type==="task"?`/my-tasks?task=${n.target_id}`:n.target_type==="meeting"?`/meetings/${n.target_id}`:n.target_type==="risk"?`/risks?project=${n.project_id}&risk=${n.target_id}#${n.target_id}`:n.target_type==="approval"?`/approvals?project=${n.project_id}&status=all&proposal=${n.target_id}#${n.target_id}`:n.target_type==="document"?`/documents?project=${n.project_id}`:`/projects/${n.target_id}`;
 const {error:readError}=await db.rpc("mark_notifications_read",{target_id:id});checkDatabase(readError);
 (await cookies()).set(activeWorkspaceCookie,n.workspace_id,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:31536000});return json({href});
 }catch(e){return httpError(e);}}
