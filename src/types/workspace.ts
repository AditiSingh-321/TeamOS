export type ProjectStatus = "On track" | "At risk" | "Planning";
export type ProjectIcon = "rocket" | "layers" | "chart" | "compass";

export interface Member {
  id: string;
  name: string;
  initials: string;
  tone: "violet" | "green" | "rose" | "blue" | "amber";
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  deadline: string | null;
  progress: number;
  updated_at: string;
}
