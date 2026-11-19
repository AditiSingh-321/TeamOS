import { z } from "zod";
import { collaborationUser,json,checkDatabase } from "@/lib/collaboration/server";
import { httpError,assertSameOrigin } from "@/lib/knowledge/http";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const id=z.uuid().parse((await params).id);const {db}=await collaborationUser();const {data,error}=await db.rpc("mark_notifications_read",{target_id:id});checkDatabase(error);return json({updated:data});}catch(e){return httpError(e);}}
