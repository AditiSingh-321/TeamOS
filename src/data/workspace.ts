import type { Activity, Member, Project, Task } from "@/types/workspace";

export const currentUser = { id: "alex", name: "Alex Morgan", initials: "AM", tone: "violet" } satisfies Member;
const nina = { id: "nina", name: "Nina Park", initials: "NP", tone: "green" } satisfies Member;
const josh = { id: "josh", name: "Josh Rivera", initials: "JR", tone: "rose" } satisfies Member;
const maya = { id: "maya", name: "Maya Chen", initials: "MC", tone: "blue" } satisfies Member;
const eli = { id: "eli", name: "Eli Brooks", initials: "EB", tone: "amber" } satisfies Member;

export const workspace = { name: "Studio North", initials: "SN", date: "2026-11-17" };

export const projects: Project[] = [
  { id: "launch", name: "Website Relaunch", description: "Refresh the marketing site for the winter launch.", status: "On track", icon: "rocket", deadline: "2026-12-04", updatedAt: "2026-11-17", members: [currentUser, nina, josh] },
  { id: "design", name: "Design System", description: "Build a shared library for product and brand teams.", status: "On track", icon: "layers", deadline: "2026-12-11", updatedAt: "2026-11-17", members: [maya, currentUser, nina] },
  { id: "analytics", name: "Product Analytics", description: "Define core metrics and improve event tracking.", status: "At risk", icon: "chart", deadline: "2026-12-08", updatedAt: "2026-11-16", members: [eli, maya, currentUser] },
  { id: "onboarding", name: "Customer Onboarding", description: "Map the first-run experience and shorten time to value.", status: "Planning", icon: "compass", deadline: "2026-12-18", updatedAt: "2026-11-13", members: [josh, eli, currentUser] },
];

export const tasks: Task[] = [
  { id: "hero", title: "Review homepage wireframes", projectId: "launch", assignee: currentUser, priority: "High", status: "In progress", due: "2026-11-17" },
  { id: "tokens", title: "Finalize color tokens", projectId: "design", assignee: currentUser, priority: "Medium", status: "To do", due: "2026-11-19" },
  { id: "events", title: "Draft event tracking plan", projectId: "analytics", assignee: currentUser, priority: "High", status: "To do", due: "2026-11-20" },
  { id: "journey", title: "Outline the onboarding flow", projectId: "onboarding", assignee: currentUser, priority: "Low", status: "To do", due: "2026-11-23" },
  { id: "audit", title: "Audit existing landing pages", projectId: "launch", assignee: currentUser, priority: "Medium", status: "Completed", due: "2026-11-16" },
  { id: "brief", title: "Approve launch brief", projectId: "launch", assignee: nina, priority: "High", status: "Completed", due: "2026-11-16" },
  { id: "copy", title: "Write launch page copy", projectId: "launch", assignee: josh, priority: "Medium", status: "In progress", due: "2026-11-24" },
  { id: "type", title: "Publish typography scale", projectId: "design", assignee: maya, priority: "Medium", status: "Completed", due: "2026-11-16" },
  { id: "patterns", title: "Document navigation patterns", projectId: "design", assignee: nina, priority: "Low", status: "To do", due: "2026-11-26" },
  { id: "report", title: "Inventory current dashboards", projectId: "analytics", assignee: eli, priority: "Medium", status: "Completed", due: "2026-11-13" },
  { id: "metric", title: "Define activation metric", projectId: "analytics", assignee: maya, priority: "High", status: "In progress", due: "2026-11-24" },
  { id: "interviews", title: "Schedule customer interviews", projectId: "onboarding", assignee: josh, priority: "Medium", status: "To do", due: "2026-11-27" },
];

export const activity: Activity[] = [
  { id: "type", person: maya, action: "completed", subject: "Publish typography scale", time: "Today, 10:42 AM" },
  { id: "brief", person: nina, action: "completed", subject: "Approve launch brief", time: "Yesterday, 4:20 PM" },
  { id: "copy", person: josh, action: "started", subject: "Write launch page copy", time: "Yesterday, 2:10 PM" },
];
