import { collaborationUser,json,checkDatabase } from "@/lib/collaboration/server";
import { httpError } from "@/lib/knowledge/http";
export async function GET(){try{const {db,user}=await collaborationUser();const {count,error}=await db.from("notifications").select("id",{count:"exact",head:true}).eq("recipient_user_id",user.id).is("read_at",null);checkDatabase(error);return json({count:count??0});}catch(e){return httpError(e);}}
