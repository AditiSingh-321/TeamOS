import { createAuthClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { riskSummary } from "@/lib/intelligence/queries";
export async function ProjectHealth({workspaceId}:{workspaceId:string}){
 const db=await createAuthClient();
 const [summary,overdue,approvals]=await Promise.all([riskSummary(workspaceId),db?.from("tasks").select("id",{head:true,count:"exact"}).eq("workspace_id",workspaceId).neq("status","Done").lt("due_date",new Date().toISOString().slice(0,10)),db?.from("action_proposals").select("id",{head:true,count:"exact"}).eq("workspace_id",workspaceId).eq("status","pending")]);
 return <Card className="space-y-2 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Project health</h2><Link href="/risks" className="text-sm text-primary hover:underline">Risk Center</Link></div><p className="text-sm text-muted-foreground">{summary?`${summary.active} active risks · ${summary.high} high or critical · ${summary.affected} potentially affected tasks`:"Apply the Phase 8 migration to see project risk intelligence."}</p><div className="flex flex-wrap gap-4 text-sm"><Link href="/my-tasks" className="text-primary hover:underline">{overdue?.error?"—":overdue?.count??0} overdue tasks</Link><Link href="/approvals" className="text-primary hover:underline">{approvals?.error?"—":approvals?.count??0} pending approvals</Link></div></Card>;
}
