import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/layout/page-heading";
import { ProjectScope } from "@/components/intelligence/project-scope";
import { ActionRequest } from "@/components/intelligence/action-request";
import { ProposalCard,type ProposalInfo } from "@/components/intelligence/proposal-card";
import { Card } from "@/components/ui/card";
import { intelligenceScope } from "@/lib/intelligence/queries";
export const metadata={title:"Approval Center"};
export default async function Page({searchParams}:{searchParams:Promise<{project?:string;status?:string;proposal?:string}>}){
 const params=await searchParams;const scope=await intelligenceScope(params.project);const {db,project,active}=scope;const statuses=["all","pending","approved","executed","rejected","failed","cancelled"];const status=statuses.includes(params.status??"")?params.status!:"pending";
 let query=project&&db?db.from("action_proposals").select("*").eq("project_id",project.id).order("created_at",{ascending:false}).limit(100):null;if(status!=="all")query=query?.eq("status",status)??null;
 if(params.proposal&&/^[0-9a-f-]{36}$/i.test(params.proposal))query=query?.eq("id",params.proposal)??null;
 const [proposals,tasks,members]=project&&db&&active?await Promise.all([query,db.from("tasks").select("id,title").eq("project_id",project.id).order("title").limit(1000),db.from("workspace_members").select("user_id,display_name").eq("workspace_id",active.id)]):[null,null,null];
 const rows=(proposals?.data??[]) as ProposalInfo[];const ids=rows.map(row=>row.id);const logs=db&&ids.length?await db.from("action_execution_logs").select("proposal_id,outcome,created_at,error_message").in("proposal_id",ids).order("created_at").limit(1000):null;
 return <div className="space-y-5"><PageHeading title="Approval Center" description="Review proposed changes before they can affect your project."/><ProjectScope path="/approvals" projects={scope.projects} selected={project?.id}/>{scope.error&&<p role="alert">{scope.error}</p>}{proposals?.error?<p role="alert" className="text-sm text-destructive">Apply the Phase 10 migration to enable approvals.</p>:project&&<ActionRequest projectId={project.id} tasks={tasks?.data??[]} members={members?.data??[]}/>}
 {project&&<form action="/approvals" className="flex flex-wrap gap-3"><input type="hidden" name="project" value={project.id}/><label className="grid gap-1 text-sm">Proposal status<select name="status" defaultValue={status} className="rounded-md border px-3 py-2">{statuses.map(value=><option key={value}>{value}</option>)}</select></label><button className="self-end ui-secondary">Filter</button></form>}
 {!proposals?.error&&!rows.length&&<Card><EmptyState icon={ClipboardCheck} title="Nothing waiting in this view" description="Propose an action above, or send reviewed meeting actions and risk follow-ups here. You stay in control of every change."/></Card>}
 {rows.map(proposal=><ProposalCard key={`${proposal.id}:${proposal.revision}`} proposal={proposal} members={members?.data??[]} tasks={tasks?.data??[]} manager={["owner","admin"].includes(active?.role??"")} userId={scope.profile.id} logs={logs?.data?.filter(log=>log.proposal_id===proposal.id)??[]}/>)}{rows.length===100&&<p className="text-xs text-muted-foreground">Showing the latest 100 proposals in this status.</p>}</div>;
}
