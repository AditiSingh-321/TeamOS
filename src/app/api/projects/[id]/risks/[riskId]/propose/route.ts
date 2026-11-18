import { assertSameOrigin,httpError,projectContext } from "@/lib/knowledge/http";
import { intelligenceRpc } from "@/lib/intelligence/db";
import { KnowledgeError } from "@/lib/knowledge/validation";
export async function POST(request:Request,context:{params:Promise<{id:string;riskId:string}>}){try{assertSameOrigin(request);const {id,riskId}=await context.params;const {supabase,project}=await projectContext(id);const {data}=await supabase.from("project_risks").select("id").eq("id",riskId).eq("project_id",project.id).maybeSingle();if(!data)throw new KnowledgeError("Risk unavailable.",404);const proposalId=await intelligenceRpc(supabase,"propose_risk_followup",{target_risk:riskId});return Response.json({proposalId});}catch(error){return httpError(error);}}
