import { ProjectPresence } from "@/components/collaboration/project-presence";
import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { ActivityFeed } from "@/components/collaboration/activity-feed";
import { PageHeading } from "@/components/layout/page-heading";
import { getWorkspaceContext,getProject } from "@/lib/workspaces/queries";
export const metadata={title:"Project Activity"};
export default async function ProjectPage({params,searchParams}:{params:Promise<{projectId:string}>;searchParams:Promise<{page?:string;type?:string}>}){
 const [{projectId},query,{active}]=await Promise.all([params,searchParams,getWorkspaceContext()]);if(!active||!z.uuid().safeParse(projectId).success)notFound();const {project}=await getProject(active.id,projectId);if(!project)notFound();
 const parsed=z.coerce.number().int().min(1).max(10000).safeParse(query.page??1);const type=query.type&&/^[a-z_]{1,40}$/.test(query.type)?query.type:undefined;
 return <div className="space-y-6"><PageHeading title={project.name} description={project.description||"Project overview and recent changes."}/><ProjectPresence workspaceId={active.id} projectId={projectId}/><nav aria-label="Project views" className="flex gap-4 text-sm font-medium text-primary"><Link href={`/dependencies?project=${project.id}`}>Dependencies</Link><Link href={`/risks?project=${project.id}`}>Risks</Link><Link href={`/meetings?project=${project.id}`}>Meetings</Link><Link href={`/approvals?project=${project.id}`}>Approvals</Link></nav><ActivityFeed workspaceId={active.id} projectId={projectId} page={parsed.success?parsed.data:1} type={type}/></div>;
}
