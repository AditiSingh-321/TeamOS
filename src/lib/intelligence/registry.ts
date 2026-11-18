import { z } from "zod";
import { taskInputSchema,commentInputSchema } from "../tasks/validation";
import { taskStatuses,taskPriorities } from "../../types/task";
const taskId=z.uuid();const date=z.iso.date().refine(value=>!value.startsWith("0000")).nullable();
export const createPayloadSchema=z.strictObject({title:taskInputSchema.shape.title,description:taskInputSchema.shape.description,priority:z.enum(taskPriorities),due_date:date,assignee_id:z.uuid().nullable()});
export const actionSchema=z.discriminatedUnion("type",[
 z.strictObject({type:z.literal("CREATE_TASK"),payload:createPayloadSchema}),
 z.strictObject({type:z.literal("UPDATE_TASK_STATUS"),payload:z.strictObject({taskId,status:z.enum(taskStatuses)})}),
 z.strictObject({type:z.literal("UPDATE_TASK_PRIORITY"),payload:z.strictObject({taskId,priority:z.enum(taskPriorities)})}),
 z.strictObject({type:z.literal("UPDATE_TASK_DUE_DATE"),payload:z.strictObject({taskId,due_date:date})}),
 z.strictObject({type:z.literal("ASSIGN_TASK"),payload:z.strictObject({taskId,assignee_id:z.uuid().nullable()})}),
 z.strictObject({type:z.literal("ADD_TASK_COMMENT"),payload:z.strictObject({taskId,body:commentInputSchema.shape.body})}),
]);
export type AgentAction=z.infer<typeof actionSchema>;
export const actionRegistry={
 CREATE_TASK:{label:"Create task",field:null,permission:"manager",handler:"create_task"},
 UPDATE_TASK_STATUS:{label:"Update status",field:"status",permission:"manager",handler:"move_task"},
 UPDATE_TASK_PRIORITY:{label:"Update priority",field:"priority",permission:"manager",handler:"update_priority"},
 UPDATE_TASK_DUE_DATE:{label:"Update due date",field:"due_date",permission:"manager",handler:"update_due_date"},
 ASSIGN_TASK:{label:"Assign task",field:"assignee_id",permission:"manager",handler:"assign_task"},
 ADD_TASK_COMMENT:{label:"Add comment",field:null,permission:"manager",handler:"add_comment"},
} as const;
export const actionPlanSchema=z.strictObject({clarification:z.string().max(600).nullable(),actions:z.array(z.strictObject({action:actionSchema,reason:z.string().min(1).max(800)})).max(8)});
export function validateActionReferences(action:AgentAction,tasks:{id:string}[],members:{user_id:string}[]){
 const payload=action.payload;
 if("taskId" in payload&&!tasks.some(task=>task.id===payload.taskId))throw new Error("Choose a task in the selected project.");
 if("assignee_id" in payload&&payload.assignee_id&&!members.some(member=>member.user_id===payload.assignee_id))throw new Error("Choose a member of this workspace.");
 return action;
}
export function isActionRequest(text:string){return /\b(create|assign|reassign|move|mark|set|update|change|add|schedule)\b/i.test(text)&&!/^\s*(what|which|how many|when|who|why)\b/i.test(text);}

export function isOverdueTaskQuestion(text:string){return /^\s*(what|which|list|show)\b/i.test(text)&&/\btasks?\b/i.test(text)&&/\b(overdue|past due)\b/i.test(text)&&!isActionRequest(text);}
