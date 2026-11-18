import { z } from "zod";
import { assertSameOrigin,httpError } from "@/lib/knowledge/http";
import { meetingContext,intelligenceBody } from "@/lib/intelligence/meeting-http";
import { meetingInputSchema } from "@/lib/intelligence/meeting";
import { intelligenceRpc } from "@/lib/intelligence/db";
type Context={params:Promise<{id:string;meetingId:string}>};
export async function GET(_request:Request,context:Context){try{const {id,meetingId}=await context.params;const {supabase,meeting}=await meetingContext(id,meetingId);const {data}=await supabase.from("meeting_analyses").select("*").eq("meeting_id",meetingId).order("meeting_revision",{ascending:false}).limit(20);return Response.json({meeting,analyses:data??[]},{headers:{"Cache-Control":"no-store"}});}catch(error){return httpError(error);}}
export async function PATCH(request:Request,context:Context){try{assertSameOrigin(request);const {id,meetingId}=await context.params;const {supabase}=await meetingContext(id,meetingId);const {revision,...input}=meetingInputSchema.extend({revision:z.number().int().positive()}).parse(await intelligenceBody(request));await intelligenceRpc(supabase,"save_meeting",{target_project:id,meeting_id:meetingId,expected_revision:revision,input});return Response.json({id:meetingId});}catch(error){return httpError(error);}}
export async function DELETE(request:Request,context:Context){try{assertSameOrigin(request);const {id,meetingId}=await context.params;const {supabase}=await meetingContext(id,meetingId);const {revision}=z.object({revision:z.number().int().positive()}).parse(await intelligenceBody(request));await intelligenceRpc(supabase,"delete_meeting",{target_meeting:meetingId,expected_revision:revision});return Response.json({deleted:true});}catch(error){return httpError(error);}}
