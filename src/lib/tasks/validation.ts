import { z } from "zod";
import { idSchema } from "@/lib/workspaces/validation";
import { taskPriorities, taskStatuses } from "@/types/task";

const optionalId = z.union([idSchema, z.literal("")]).transform((value) => value || null);
const optionalDate = z.union([z.iso.date().refine((value) => !value.startsWith("0000")), z.literal("")])
  .transform((value) => value || null);

export const taskInputSchema = z.object({
  workspace_id: idSchema,
  project_id: optionalId,
  assignee_id: optionalId,
  title: z.string().trim().min(1, "Enter a title.").max(120, "Keep the title under 121 characters."),
  description: z.string().trim().max(5000),
  status: z.enum(taskStatuses),
  priority: z.enum(taskPriorities),
  due_date: optionalDate,
});

export const taskMutationSchema = z.object({
  workspaceId: idSchema,
  taskId: idSchema,
  updatedAt: z.iso.datetime({ offset: true }),
});

export const moveTaskSchema = taskMutationSchema.extend({ status: z.enum(taskStatuses) });

export const commentInputSchema = z.object({
  workspaceId: idSchema,
  taskId: idSchema,
  body: z.string().trim().min(1, "Enter a comment.").max(2000, "Keep comments to 2,000 characters."),
});
