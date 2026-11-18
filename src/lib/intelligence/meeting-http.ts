import { z } from "zod";
import { boundedBody, projectContext } from "@/lib/knowledge/http";
import { KnowledgeError } from "@/lib/knowledge/validation";
export async function meetingContext(projectId:string,meetingId:string){
 const context=await projectContext(projectId);
 if(!z.uuid().safeParse(meetingId).success)throw new KnowledgeError("Meeting unavailable.",404);
 const {data:meeting}=await context.supabase.from("meetings").select("*").eq("id",meetingId).eq("project_id",context.project.id).maybeSingle();
 if(!meeting)throw new KnowledgeError("Meeting unavailable. Check the Phase 9 migration.",404);
 return {...context,meeting};
}
export async function intelligenceBody(request:Request){return JSON.parse((await boundedBody(request,100000)).toString("utf8")) as unknown;}
