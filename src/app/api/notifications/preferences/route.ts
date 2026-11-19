import { z } from "zod";
import { collaborationUser,json,checkDatabase } from "@/lib/collaboration/server";
import { httpError,assertSameOrigin,boundedBody } from "@/lib/knowledge/http";
const schema=z.strictObject({assignments:z.boolean(),mentions:z.boolean(),reminders:z.boolean(),risks:z.boolean(),approvals:z.boolean(),meetings:z.boolean()});
export async function GET(){try{const {db,user}=await collaborationUser();const {data,error}=await db.from("notification_preferences").select("assignments,mentions,reminders,risks,approvals,meetings").eq("user_id",user.id).maybeSingle();checkDatabase(error);return json(data??{assignments:true,mentions:true,reminders:true,risks:true,approvals:true,meetings:true});}catch(e){return httpError(e);}}
export async function PATCH(request:Request){try{assertSameOrigin(request);const input=schema.parse(JSON.parse((await boundedBody(request,2000)).toString()));const {db,user}=await collaborationUser();const {error}=await db.from("notification_preferences").upsert({user_id:user.id,...input});checkDatabase(error);return json(input);}catch(e){return httpError(e);}}
