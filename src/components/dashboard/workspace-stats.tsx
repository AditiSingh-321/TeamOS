import { CheckCircle2, ClipboardList, FolderKanban, Hourglass } from "lucide-react";
import { Card } from "@/components/ui/card";
import { projects, tasks } from "@/data/workspace";

export function WorkspaceStats() {
  const completed = tasks.filter((task) => task.status === "Completed").length;
  const stats = [
    { label: "Total Projects", value: projects.length, icon: FolderKanban, tone: "bg-violet-100 text-violet-800" },
    { label: "Total Tasks", value: tasks.length, icon: ClipboardList, tone: "bg-blue-100 text-blue-800" },
    { label: "Completed Tasks", value: completed, icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-800" },
    { label: "Pending Tasks", value: tasks.length - completed, icon: Hourglass, tone: "bg-amber-100 text-amber-800" },
  ];

  return (
    <section aria-label="Workspace statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-5">
      {stats.map(({ label, value, icon: Icon, tone }) => (
        <Card key={label} className="p-4 sm:p-5">
          <span className={`mb-3 grid size-9 place-items-center rounded-[9px] ${tone}`}><Icon size={18} aria-hidden="true" /></span>
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
          <p className="mt-1 text-[1.8rem] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
        </Card>
      ))}
    </section>
  );
}
