import { BarChart3, Compass, Layers3, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectIcon as IconName } from "@/types/workspace";

const styles = {
  rocket: { Icon: Rocket, tone: "bg-violet-soft text-violet-ink" },
  layers: { Icon: Layers3, tone: "bg-blue-soft text-blue-ink" },
  chart: { Icon: BarChart3, tone: "bg-amber-soft text-amber-ink" },
  compass: { Icon: Compass, tone: "bg-green-soft text-green-ink" },
};

export function ProjectIcon({ name }: { name: IconName }) {
  const { Icon, tone } = styles[name];
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-[10px]", tone)}><Icon size={19} aria-hidden="true" /></span>;
}
