import { assertSameOrigin,httpError,projectContext } from "@/lib/knowledge/http";
import { meetingInputSchema } from "@/lib/intelligence/meeting";
import { intelligenceBody } from "@/lib/intelligence/meeting-http";
import { intelligenceRpc } from "@/lib/intelligence/db";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 try{const {supabase,project}=await projectContext((await context.params).id);const {data,error}=await supabase.from("meetings").select("id,title,meeting_date,status,revision,created_by").eq("project_id",project.id).order("meeting_date",{ascending:false}).limit(200);if(error)throw new Error("Meetings unavailable");return Response.json({meetings:data},{headers:{"Cache-Control":"no-store"}});}catch(error){return httpError(error);}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{assertSameOrigin(request);const {supabase,project}=await projectContext((await context.params).id);const input=meetingInputSchema.parse(await intelligenceBody(request));const id=await intelligenceRpc(supabase,"save_meeting",{target_project:project.id,meeting_id:null,expected_revision:0,input});return Response.json({id},{status:201});}catch(error){return httpError(error);}
}
