import { currentUser, projects, tasks } from "@/data/workspace";

export const projectNames = new Map(projects.map(({ id, name }) => [id, name]));

export const myTasks = tasks
  .filter((task) => task.assignee.id === currentUser.id)
  .sort((a, b) => a.due.localeCompare(b.due));

export function projectProgress(projectId: string) {
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  if (!projectTasks.length) return 0;

  const completed = projectTasks.filter((task) => task.status === "Completed").length;
  return Math.round((completed / projectTasks.length) * 100);
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(date));
}
