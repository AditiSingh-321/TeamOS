import Link from "next/link";
import { Card } from "@/components/ui/card";
import { riskSummary } from "@/lib/intelligence/queries";
export async function ProjectHealth({workspaceId}:{workspaceId:string}){
 const summary=await riskSummary(workspaceId);
 return <Card className="space-y-2 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Project health</h2><Link href="/risks" className="text-sm text-primary hover:underline">Risk Center</Link></div><p className="text-sm text-muted-foreground">{summary?`${summary.active} active risks · ${summary.high} high or critical · ${summary.affected} potentially affected tasks`:"Apply the Phase 8 migration to see project risk intelligence."}</p></Card>;
}
