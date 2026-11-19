import { ShieldCheck,ArrowUpRight } from "lucide-react";
import { createAuthClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { riskSummary } from "@/lib/intelligence/queries";
export async function ProjectHealth({workspaceId}:{workspaceId:string}){
 const db=await createAuthClient();
 const [summary,overdue,approvals]=await Promise.all([riskSummary(workspaceId),db?.from("tasks").select("id",{head:true,count:"exact"}).eq("workspace_id",workspaceId).neq("status","Done").lt("due_date",new Date().toISOString().slice(0,10)),db?.from("action_proposals").select("id",{head:true,count:"exact"}).eq("workspace_id",workspaceId).eq("status","pending")]);
 return <Card className="space-y-4 p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="panel-heading flex items-center gap-2"><span className="grid size-8 place-items-center rounded-xl bg-green-soft text-green-ink"><ShieldCheck size={17} aria-hidden="true"/></span>Project health</h2><Link href="/risks" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Risk Center<ArrowUpRight size={13} aria-hidden="true"/></Link></div><p className="text-xs leading-6 text-muted-foreground">{summary?`${summary.active} active risks · ${summary.high} high or critical · ${summary.affected} potentially affected tasks`:"Apply the Phase 8 migration to see project risk intelligence."}</p><div className="flex flex-wrap gap-4 border-t pt-3 text-xs font-medium"><Link href="/my-tasks" className="text-primary hover:underline">{overdue?.error?"—":overdue?.count??0} overdue tasks</Link><Link href="/approvals" className="text-primary hover:underline">{approvals?.error?"—":approvals?.count??0} pending approvals</Link></div></Card>;
}
