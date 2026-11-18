export const taskStatuses = ["To Do", "In Progress", "Review", "Done"] as const;
export const taskPriorities = ["Low", "Medium", "High"] as const;

export type TaskStatus = typeof taskStatuses[number];
export type Priority = typeof taskPriorities[number];

export interface Task {
  id: string;
  project_id: string | null;
  assignee_id: string | null;
  created_by: string | null;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  due_date: string | null;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface TaskProject {
  id: string;
  name: string;
}

export interface TaskCounts {
  total: number;
  done: number;
}
