import Link from "next/link";
import { intelligenceScope } from "@/lib/intelligence/queries";
import { PageHeading } from "@/components/layout/page-heading";
import { ProjectScope } from "@/components/intelligence/project-scope";
import { MeetingEditor } from "@/components/intelligence/meeting-editor";
import { Card } from "@/components/ui/card";
export const metadata={title:"Meetings"};
export default async function Page({searchParams}:{searchParams:Promise<{project?:string}>}){
 const scope=await intelligenceScope((await searchParams).project);const {project,db}=scope;
 const result=project&&db?await db.from("meetings").select("id,title,meeting_date,status").eq("project_id",project.id).order("meeting_date",{ascending:false}).limit(200):null;
 return <div className="space-y-5"><PageHeading title="Meetings" description="Turn notes into reviewed decisions and proposed next steps."/><ProjectScope path="/meetings" projects={scope.projects} selected={project?.id}/>{scope.error&&<p role="alert">{scope.error}</p>}{result?.error?<p role="alert" className="text-sm text-destructive">Apply the Phase 9 migration to enable meetings.</p>:project&&<MeetingEditor projectId={project.id}/>}
 {result&&!result.error&&!result.data?.length&&<Card className="p-5 text-sm text-muted-foreground">No meetings yet. Paste notes or import a TXT or Markdown transcript to begin.</Card>}
 <ul className="grid gap-4 md:grid-cols-2">{result?.data?.map(meeting=><li key={meeting.id}><Card className="space-y-2 p-5"><Link className="font-semibold text-primary hover:underline" href={`/meetings/${meeting.id}?project=${project?.id}`}>{meeting.title}</Link><p className="text-xs text-muted-foreground">{meeting.meeting_date} · {meeting.status}</p></Card></li>)}</ul></div>;
}
