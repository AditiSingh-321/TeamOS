import { z } from "zod";
import { assertSameOrigin,httpError,projectContext } from "@/lib/knowledge/http";
import { intelligenceBody } from "@/lib/intelligence/meeting-http";
import { intelligenceRpc } from "@/lib/intelligence/db";
import { actionSchema } from "@/lib/intelligence/registry";
import { executeApprovedProposal } from "@/lib/tasks/proposal-service";
import { KnowledgeError } from "@/lib/knowledge/validation";
export async function POST(request:Request,context:{params:Promise<{id:string;proposalId:string}>}){
 try{assertSameOrigin(request);const {id,proposalId}=await context.params;const {supabase,project}=await projectContext(id);const input=z.discriminatedUnion("operation",[z.object({operation:z.literal("edit"),revision:z.number().int().positive(),action:actionSchema}),z.object({operation:z.enum(["approve","reject","cancel"]),revision:z.number().int().positive()})]).parse(await intelligenceBody(request));
 const {data:proposal}=await supabase.from("action_proposals").select("id,revision,action_type,payload").eq("id",proposalId).eq("project_id",project.id).maybeSingle();if(!proposal)throw new KnowledgeError("Proposal unavailable.",404);
 if(input.operation==="edit"){if(proposal.action_type!==input.action.type)throw new KnowledgeError("Keep the proposal action type unchanged.");await intelligenceRpc(supabase,"edit_action_proposal",{target_proposal:proposal.id,expected_revision:input.revision,payload:input.action.payload});return Response.json({saved:true});}
 const result=input.operation==="approve"?await executeApprovedProposal(supabase,{...proposal,revision:input.revision}):await intelligenceRpc(supabase,"review_action_proposal",{target_proposal:proposal.id,expected_revision:input.revision,operation:input.operation});return Response.json(result);
 }catch(error){return httpError(error);}
}
