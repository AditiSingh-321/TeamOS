"use client";
import { useActionState,useState } from "react";
import { useRouter } from "next/navigation";
import { addTaskComment } from "@/lib/tasks/actions";
import { fieldClass } from "@/components/workspaces/styles";
import type { WorkspaceActionState,WorkspaceMember } from "@/types/team";
export function CommentForm({workspaceId,taskId,members,requestId}:{workspaceId:string;taskId:string;members:WorkspaceMember[];requestId:string}){
 const [id,setId]=useState(requestId),[body,setBody]=useState(""),[mentions,setMentions]=useState<string[]>([]);const router=useRouter();
 const [state,submit,pending]=useActionState(async(previous:WorkspaceActionState,form:FormData)=>{const result=await addTaskComment(previous,form);if(result.message){setId(crypto.randomUUID());setBody("");setMentions([]);router.refresh();}return result;},{});
 return <form action={submit} className="space-y-3"><fieldset disabled={pending} className="grid gap-3"><input type="hidden" name="workspaceId" value={workspaceId}/><input type="hidden" name="taskId" value={taskId}/><input type="hidden" name="requestId" value={id}/><label className="grid gap-1 text-sm font-medium">Comment<textarea name="body" rows={3} required maxLength={2000} value={body} onChange={e=>setBody(e.target.value)} className={fieldClass}/></label><label className="grid gap-1 text-sm font-medium">Mention members (optional)<select multiple name="mentions" value={mentions} onChange={e=>setMentions(Array.from(e.target.selectedOptions).map(o=>o.value))} className={fieldClass} aria-describedby="mention-help">{members.map(m=><option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label><p id="mention-help" className="text-xs text-muted-foreground">Select up to 10 members. Only explicitly selected members receive a mention notification.</p><button className="w-fit rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending?"Posting…":"Post comment"}</button></fieldset>{state.error&&<p role="alert" className="text-sm text-destructive">{state.error}</p>}{state.message&&<p role="status" className="text-sm text-emerald-800">{state.message}</p>}</form>;
}
