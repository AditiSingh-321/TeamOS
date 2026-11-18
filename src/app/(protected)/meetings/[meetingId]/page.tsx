import Link from "next/link";
import { SourceProposalButton } from "@/components/intelligence/proposal-buttons";
import { QueueStatus } from "@/components/intelligence/queue-status";
import { intelligenceScope } from "@/lib/intelligence/queries";
import { PageHeading } from "@/components/layout/page-heading";
import { MeetingEditor,MeetingOperations,type MeetingInfo } from "@/components/intelligence/meeting-editor";
import { MeetingReview,type MeetingAnalysisInfo } from "@/components/intelligence/meeting-review";
import { Card } from "@/components/ui/card";
export const metadata={title:"Meeting details"};
export default async function Page({params}:{params:Promise<{meetingId:string}>}){
 const scope=await intelligenceScope();const id=(await params).meetingId;
 const result=scope.db&&scope.active?await scope.db.from("meetings").select("*").eq("id",id).eq("workspace_id",scope.active.id).maybeSingle():null;
 const meeting=result?.data as MeetingInfo|null;
 if(!meeting||!scope.db)return <p role="alert">Meeting unavailable in this workspace. <Link href="/meetings" className="text-primary">Open meetings</Link></p>;
 const [analyses,tasks,members]=await Promise.all([scope.db.from("meeting_analyses").select("*").eq("meeting_id",id).order("meeting_revision",{ascending:false}).limit(20),scope.db.from("tasks").select("id,title").eq("project_id",meeting.project_id).order("title").limit(1000),scope.db.from("workspace_members").select("user_id,display_name").eq("workspace_id",scope.active!.id)]);
 const analysis=analyses.data?.find(row=>row.meeting_revision===meeting.revision) as MeetingAnalysisInfo|undefined;
 const proposals=await scope.db.from("action_proposals").select("id,action_type,status,result").eq("project_id",meeting.project_id).eq("source_type","meeting").eq("source_id",id).order("created_at",{ascending:false}).limit(50);
 const editable=meeting.created_by===scope.profile.id||["owner","admin"].includes(scope.active?.role??"");
 return <div className="space-y-5"><Link href={`/meetings?project=${meeting.project_id}`} className="text-sm text-primary hover:underline">← Meetings</Link><PageHeading title={meeting.title} description={`${meeting.meeting_date} · ${meeting.participants.join(", ")||"No participants recorded"} · Revision ${meeting.revision}`}/><MeetingOperations meeting={meeting} analysisStatus={analysis?.status} editable={editable}/><Card className="p-5"><details open><summary className="cursor-pointer font-semibold">Original meeting notes</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{meeting.transcript}</p></details></Card>{editable&&<details><summary className="cursor-pointer text-sm text-primary">Edit meeting metadata or notes</summary><div className="mt-3"><MeetingEditor key={meeting.revision} projectId={meeting.project_id} meeting={meeting}/></div></details>}
 <QueueStatus projectId={meeting.project_id} manager={["owner","admin"].includes(scope.active?.role??"")}/>
 {analysis?.status==="reviewed"&&<SourceProposalButton projectId={meeting.project_id} meetingId={id} analysisId={analysis.id} revision={analysis.revision}/>}
 {proposals.data&&proposals.data.length>0&&<Card className="space-y-2 p-5"><h2 className="font-semibold">Proposed and approved task changes</h2>{proposals.data.map(proposal=><Link key={proposal.id} className="block text-sm text-primary hover:underline" href={`/approvals?project=${meeting.project_id}&status=all#${proposal.id}`}>{proposal.action_type.replaceAll("_"," ")} · {proposal.status}</Link>)}</Card>}
 {analysis&&<MeetingReview key={`${analysis.id}:${analysis.revision}`} analysis={analysis} meetingId={id} projectId={meeting.project_id} tasks={tasks.data??[]} members={members.data??[]} editable={editable}/>}
 </div>;
}
