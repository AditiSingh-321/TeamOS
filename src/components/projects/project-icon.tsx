import { BarChart3, Compass, Layers3, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectIcon as IconName } from "@/types/workspace";

const styles = {
  rocket: { Icon: Rocket, tone: "bg-violet-100 text-violet-700" },
  layers: { Icon: Layers3, tone: "bg-blue-100 text-blue-700" },
  chart: { Icon: BarChart3, tone: "bg-amber-100 text-amber-800" },
  compass: { Icon: Compass, tone: "bg-emerald-100 text-emerald-800" },
};

export function ProjectIcon({ name }: { name: IconName }) {
  const { Icon, tone } = styles[name];
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-[10px]", tone)}><Icon size={19} aria-hidden="true" /></span>;
}
