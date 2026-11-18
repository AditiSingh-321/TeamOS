import { z } from "zod";
import { assertSameOrigin,httpError } from "@/lib/knowledge/http";
import { meetingContext,intelligenceBody } from "@/lib/intelligence/meeting-http";
import { intelligenceRpc } from "@/lib/intelligence/db";
import { KnowledgeError } from "@/lib/knowledge/validation";
export async function POST(request:Request,context:{params:Promise<{id:string;meetingId:string}>}){try{assertSameOrigin(request);const {id,meetingId}=await context.params;const {supabase}=await meetingContext(id,meetingId);const input=z.object({analysisId:z.uuid(),revision:z.number().int().positive()}).parse(await intelligenceBody(request));const {data}=await supabase.from("meeting_analyses").select("id").eq("id",input.analysisId).eq("meeting_id",meetingId).maybeSingle();if(!data)throw new KnowledgeError("Analysis unavailable.",404);const proposalIds=await intelligenceRpc(supabase,"propose_meeting_actions",{target_analysis:input.analysisId,expected_revision:input.revision});return Response.json({proposalIds});}catch(error){return httpError(error);}}
