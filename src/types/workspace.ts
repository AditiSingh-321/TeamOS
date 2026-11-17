export type ProjectStatus = "On track" | "At risk" | "Planning";
export type TaskStatus = "In progress" | "To do" | "Completed";
export type Priority = "High" | "Medium" | "Low";
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
  icon: ProjectIcon;
  deadline: string;
  updatedAt: string;
  members: Member[];
}

export interface Task {
  id: string;
  title: string;
  projectId: string;
  assignee: Member;
  priority: Priority;
  status: TaskStatus;
  due: string;
}

export interface Activity {
  id: string;
  person: Member;
  action: string;
  subject: string;
  time: string;
}
