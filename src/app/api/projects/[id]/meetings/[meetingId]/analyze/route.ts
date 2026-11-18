import { z } from "zod";
import { assertSameOrigin,httpError } from "@/lib/knowledge/http";
import { meetingContext,intelligenceBody } from "@/lib/intelligence/meeting-http";
import { intelligenceRpc } from "@/lib/intelligence/db";
export async function POST(request:Request,context:{params:Promise<{id:string;meetingId:string}>}){try{assertSameOrigin(request);const {id,meetingId}=await context.params;const {supabase}=await meetingContext(id,meetingId);const {revision}=z.object({revision:z.number().int().positive()}).parse(await intelligenceBody(request));const analysisId=await intelligenceRpc(supabase,"queue_meeting_analysis",{target_meeting:meetingId,expected_revision:revision});return Response.json({analysisId},{status:202});}catch(error){return httpError(error);}}
