import { z } from "zod";
import { taskStatuses } from "../../types/task";
const evidence = z.string().min(1).max(2000);
const nullableText = z.string().max(160).nullable();
export const meetingInputSchema = z.strictObject({ title:z.string().trim().min(1).max(120), meeting_date:z.iso.date(),participants:z.array(z.string().trim().min(1).max(100)).max(30),transcript:z.string().trim().min(20).max(16000) });
export const meetingAnalysisSchema = z.strictObject({
 summary:z.string().min(1).max(2000),
 decisions:z.array(z.strictObject({description:z.string().min(1).max(800),evidence})).max(10),
 actionItems:z.array(z.strictObject({title:z.string().min(1).max(120),description:z.string().max(2000),assigneeName:nullableText,dueDate:z.iso.date().nullable(),priority:z.enum(["Low","Medium","High"]),relatedTaskTitle:nullableText,evidence})).max(10),
 blockers:z.array(z.strictObject({description:z.string().min(1).max(800),relatedTaskTitle:nullableText,evidence})).max(10),
 taskUpdates:z.array(z.strictObject({description:z.string().min(1).max(800),relatedTaskTitle:nullableText,suggestedStatus:z.enum(taskStatuses).nullable(),evidence})).max(10),
 openQuestions:z.array(z.string().min(1).max(500)).max(10),recommendations:z.array(z.string().min(1).max(500)).max(10),
});
export const reviewedMeetingSchema = meetingAnalysisSchema.extend({
 decisions:z.array(meetingAnalysisSchema.shape.decisions.element.extend({ignore:z.boolean()})).max(10),
 actionItems:z.array(meetingAnalysisSchema.shape.actionItems.element.extend({target:z.enum(["create","update","ignore"]),taskId:z.uuid().nullable(),assigneeId:z.uuid().nullable()})).max(10),
 blockers:z.array(meetingAnalysisSchema.shape.blockers.element.extend({taskId:z.uuid().nullable(),ignore:z.boolean()})).max(10),
 taskUpdates:z.array(meetingAnalysisSchema.shape.taskUpdates.element.extend({taskId:z.uuid().nullable(),ignore:z.boolean()})).max(10),
});
export type ReviewedMeeting = z.infer<typeof reviewedMeetingSchema>;
export function matchingTask(title:string|null,tasks:{id:string;title:string}[]) {
 const normalize=(text:string)=>text.trim().replace(/\s+/g," ").toLowerCase();
 const matches=title?tasks.filter(task=>normalize(task.title)===normalize(title)):[];return matches.length===1?matches[0].id:null;
}
export function prepareMeetingAnalysis(value:unknown,notes:string,participants:string[],tasks:{id:string;title:string}[],members:{user_id:string;display_name:string}[]):ReviewedMeeting {
 const data=meetingAnalysisSchema.parse(value);
 for(const row of [...data.decisions,...data.actionItems,...data.blockers,...data.taskUpdates])if(!notes.includes(row.evidence))throw new Error("Meeting evidence must be quoted from the original notes.");
 return {...data,decisions:data.decisions.map(row=>({...row,ignore:false})),actionItems:data.actionItems.map(row=>{
 const assignees=members.filter(member=>member.display_name.toLowerCase()===row.assigneeName?.toLowerCase()&&participants.some(name=>name.toLowerCase()===member.display_name.toLowerCase()));
 const taskId=matchingTask(row.relatedTaskTitle,tasks);
 return {...row,assigneeName:row.assigneeName&&participants.some(name=>name.toLowerCase()===row.assigneeName?.toLowerCase())?row.assigneeName:null,dueDate:row.dueDate&&row.evidence.includes(row.dueDate)?row.dueDate:null,target:taskId?"update":"create",taskId,assigneeId:assignees.length===1?assignees[0].user_id:null};
 }),blockers:data.blockers.map(row=>({...row,taskId:matchingTask(row.relatedTaskTitle,tasks),ignore:false})),taskUpdates:data.taskUpdates.map(row=>({...row,taskId:matchingTask(row.relatedTaskTitle,tasks),ignore:false}))};
}
export function meetingKnowledge(review:ReviewedMeeting,executed:{executed_at?:string;action_type:string;payload:{body?:string};result:{task:{title:string;status:string;priority:string;due_date:string|null}}}[]=[]){
 return [{content:`Reviewed meeting summary (human reviewed):\n${review.summary}`,page_number:null,section_title:"Reviewed meeting summary"},...review.decisions.filter(row=>!row.ignore).map(row=>({content:`Human-confirmed meeting decision:\n${row.description}\nSource quote: ${row.evidence}`,page_number:null,section_title:"Confirmed decisions"})),...executed.map(action=>({content:`Approved task change executed${action.executed_at?` at ${action.executed_at}`:""}: ${action.action_type}. Task: ${action.result.task.title}. Recorded status: ${action.result.task.status}. Priority: ${action.result.task.priority}. Due date: ${action.result.task.due_date??"not set"}.${action.payload.body?` Approved comment: ${action.payload.body}`:""}`,page_number:null,section_title:"Approved task changes"}))];
}

export function parseMeetingTranscript(name:string,bytes:Uint8Array) {
 if (!/\.(txt|md)$/i.test(name) || bytes.length>64000) throw new Error("Choose a TXT or Markdown transcript under 64 KB.");
 const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
 if(text.length<20||text.length>16000||text.includes("\0"))throw new Error("Use a UTF-8 transcript between 20 and 16,000 characters.");
 return text;
}
