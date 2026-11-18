import Link from "next/link";
import { Card } from "@/components/ui/card";
export function ProjectScope({path,projects,selected}:{path:string;projects:{id:string;name:string}[];selected?:string}){
 return <Card className="p-4"><form action={path} className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-1 text-sm">Project<select name="project" defaultValue={selected} className="min-w-0 rounded-md border bg-background px-3 py-2">{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="rounded-md border px-3 py-2 text-sm hover:bg-muted">Open project</button></form>{!projects.length&&<Link href="/projects" className="text-sm text-primary">Create a project to get started</Link>}</Card>;
}
