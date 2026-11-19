import Link from "next/link";
import { Card } from "@/components/ui/card";
export function ProjectScope({path,projects,selected}:{path:string;projects:{id:string;name:string}[];selected?:string}){
 return <Card className="p-4"><form action={path} className="flex flex-wrap items-center gap-3"><label className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground sm:flex-none">Project<select name="project" defaultValue={selected} className="ui-field min-w-0 flex-1 text-foreground sm:w-72">{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="ui-secondary hover:bg-muted">Open project</button></form>{!projects.length&&<Link href="/projects" className="text-sm text-primary">Create a project to get started</Link>}</Card>;
}
