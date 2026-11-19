import { collaborationUser,json,checkDatabase } from "@/lib/collaboration/server";
import { httpError,assertSameOrigin } from "@/lib/knowledge/http";
export async function POST(request:Request){try{assertSameOrigin(request);const {db}=await collaborationUser();const {data,error}=await db.rpc("mark_notifications_read",{target_id:null});checkDatabase(error);return json({updated:data});}catch(e){return httpError(e);}}
