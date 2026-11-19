import { CircleCheck, Clock3 } from "lucide-react";
import { createAuthClient } from "@/lib/supabase/server";
import { WorkspaceForm } from "@/components/workspaces/workspace-form";
import { retryIntelligence } from "@/lib/intelligence/actions";
export async function QueueStatus({projectId,manager}:{projectId:string;manager:boolean}){
 const db=await createAuthClient();const result=db?await db.rpc("intelligence_job_summary",{target_project:projectId}):null;
 if(result?.error||!result?.data)return null;const data=result.data as {pending:number;failed:number};
 return <div className="space-y-2 rounded-xl bg-muted/60 px-4 py-3"><p className="flex items-center gap-2 text-xs text-muted-foreground">{data.pending || data.failed ? <Clock3 size={15} aria-hidden="true"/> : <CircleCheck size={15} className="text-green-ink" aria-hidden="true"/>}Project analysis queue: {data.pending} pending or processing · {data.failed} failed.</p>{data.failed>0&&<p className="text-xs text-destructive">Check worker configuration and API access, then retry failed analyses.</p>}{data.failed>0&&manager&&<WorkspaceForm action={retryIntelligence} label="Retry failed analyses" compact><input type="hidden" name="projectId" value={projectId}/></WorkspaceForm>}</div>;
}
