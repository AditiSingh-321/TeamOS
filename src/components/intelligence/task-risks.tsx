import Link from "next/link";
import { createAuthClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { WorkspaceForm } from "@/components/workspaces/workspace-form";
import { flagTask } from "@/lib/intelligence/actions";
export async function TaskRisks({taskId,editable}:{taskId:string;editable:boolean}){
 const db=await createAuthClient();if(!db)return null;
 const [task,result]=await Promise.all([db.from("tasks").select("project_id,is_blocked,updated_at,status").eq("id",taskId).maybeSingle(),db.from("project_risks").select("id,title,severity,status,project_id").eq("source_task_id",taskId).order("detected_at",{ascending:false}).limit(10)]);
 if(task.error||result.error)return <p className="text-xs text-muted-foreground">Apply the Phase 8 migration to enable task risk analysis.</p>;
 if(!task.data?.project_id)return null;
 return <Card className="space-y-3 p-4"><h3 className="font-semibold">Risks and blockers</h3><p className="text-sm text-muted-foreground">{task.data.is_blocked?"Explicitly marked blocked":"No explicit blocker flag"}</p>{editable&&task.data.status!=="Done"&&<WorkspaceForm action={flagTask} label={task.data.is_blocked?"Clear blocked flag":"Mark blocked"}><input type="hidden" name="taskId" value={taskId}/><input type="hidden" name="version" value={task.data.updated_at}/><input type="hidden" name="blocked" value={String(!task.data.is_blocked)}/></WorkspaceForm>}
 {result.data?.map((risk)=><Link key={risk.id} href={`/risks?project=${risk.project_id}#${risk.id}`} className="block text-sm text-primary hover:underline">{risk.severity} · {risk.status} · {risk.title}</Link>)}{!result.data?.length&&<p className="text-xs text-muted-foreground">No detected risks. Relevant updates are analyzed by the intelligence worker.</p>}</Card>;
}
