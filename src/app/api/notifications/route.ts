import { collaborationUser,json,notificationList,pageInput } from "@/lib/collaboration/server";
import { httpError } from "@/lib/knowledge/http";
export async function GET(request:Request){try{const {db,user}=await collaborationUser();const input=pageInput.parse(Object.fromEntries(new URL(request.url).searchParams));return json(await notificationList(db,user.id,input.page,input.unread==="1"));}catch(e){return httpError(e);}}
