import { ArrowRight,ArrowUpRight,CalendarDays,CheckCircle2,FolderKanban,ListTodo,Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProjectProgress,ProjectStatusBadge } from "@/components/projects/project-card";
import { ProjectIcon } from "@/components/projects/project-icon";
import { PriorityBadge } from "@/components/tasks/task-badges";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Task } from "@/types/task";
import { formatDate } from "@/lib/workspace";
import type { Project } from "@/types/workspace";

function DashboardPanel({title,description,link,children}:{title:string;description?:string;link?:{href:string;label:string};children:ReactNode}){
 return <section className="min-w-0"><Card className="overflow-hidden"><div className="section-header"><div><h2 className="panel-heading">{title}</h2>{description&&<p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div>{link&&<Link href={link.href} className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline">{link.label}<ArrowUpRight size={14} aria-hidden="true"/></Link>}</div>{children}</Card></section>;
}
export function WelcomeBanner({name,workspaceName}:{name:string;workspaceName?:string}){
 const today=new Date().toISOString();
 return <section aria-labelledby="welcome-heading" className="hero-surface relative isolate overflow-hidden rounded-2xl px-5 py-5 sm:px-6 sm:py-5">
  <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[30%] opacity-55 lg:block"><div className="hero-orbit -right-1 -top-24"/><div className="hero-orbit -right-14 top-1"/><div className="absolute right-20 top-12 grid size-14 rotate-12 place-items-center rounded-2xl border border-white/80 bg-card/50 text-primary shadow-lg shadow-primary/10"><LayersDecoration/></div><div className="absolute -bottom-7 right-48 size-20 rounded-full bg-card/35"/></div>
  <p className="mb-2 flex items-center gap-2 text-xs font-medium text-violet-ink"><span className="grid size-6 place-items-center rounded-full bg-card/65"><CalendarDays size={12} aria-hidden="true"/></span><time dateTime={today}>{formatDate(today,{weekday:"long",month:"long",day:"numeric"})}</time></p>
  <h2 id="welcome-heading" className="max-w-lg text-[1.5rem] font-semibold tracking-[-0.035em] sm:text-[1.75rem]">Welcome back, {name.split(/\s+/)[0]}.</h2>
  <p className="mt-2 max-w-lg text-[13px] leading-6 text-muted-foreground">Here&apos;s what&apos;s happening{workspaceName?` in ${workspaceName}`:" across your workspace"}.</p>
  <div className="mt-4 flex flex-wrap gap-2.5"><Link href="/my-tasks?mine=1" className="ui-primary">View my tasks<ArrowRight size={14} aria-hidden="true"/></Link><Link href="/assistant" className="ui-secondary border-white/80 bg-card/65"><Sparkles size={14} className="text-primary" aria-hidden="true"/>Open AI Assistant</Link></div>
 </section>;
}
function LayersDecoration(){return <FolderKanban size={25} strokeWidth={1.4}/>;}
export function RecentProjects({projects}:{projects:Project[]}){
 return <DashboardPanel title="Project overview" description="A clear view of your latest work." link={{href:"/projects",label:"All projects"}}>
  {!projects.length?<EmptyState icon={FolderKanban} title="Your next project starts here" description="Create a project to bring your team's work together."><Link href="/projects" className="text-xs font-semibold text-primary hover:underline">Open projects <span aria-hidden="true">→</span></Link></EmptyState>:<ul className="divide-y">{projects.map(project=><li key={project.id} className="grid items-center gap-4 px-5 py-4 transition-colors hover:bg-background/70 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(110px,.6fr)]"><div className="flex min-w-0 items-center gap-3"><ProjectIcon name="layers"/><div className="min-w-0 space-y-2"><Link href={`/projects/${project.id}`} className="block truncate rounded text-sm font-semibold hover:text-primary">{project.name}</Link><ProjectStatusBadge status={project.status}/></div></div><ProjectProgress project={project}/></li>)}</ul>}
 </DashboardPanel>;
}
export function UpcomingTasks({tasks}:{tasks:(Pick<Task,"id"|"title"|"priority"|"due_date">&{project:{name:string}|null})[]}){
 return <DashboardPanel title="On your radar" description="Your upcoming assigned tasks." link={{href:"/my-tasks?mine=1",label:"My tasks"}}>
  {!tasks.length?<EmptyState icon={CheckCircle2} title="A little breathing room" description="No upcoming tasks assigned to you. Your next steps will appear here."/>:<ul className="divide-y">{tasks.map(task=><li key={task.id} className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-background/70 sm:px-6"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-blue-soft text-blue-ink"><ListTodo size={15} aria-hidden="true"/></span><div className="min-w-0 flex-1"><Link href={`/my-tasks?task=${task.id}&mine=1`} className="rounded text-[13px] font-medium leading-6 hover:text-primary hover:underline">{task.title}</Link>{task.project&&<p className="mt-0.5 text-xs text-muted-foreground">{task.project.name}</p>}</div><div className="flex shrink-0 flex-col items-end gap-2"><PriorityBadge priority={task.priority}/>{task.due_date&&<time dateTime={task.due_date} className="text-[11px] text-muted-foreground">{formatDate(task.due_date,{month:"short",day:"numeric"})}</time>}</div></li>)}</ul>}
 </DashboardPanel>;
}
