import { z } from "zod";
import type { ProjectStatus } from "@/types/workspace";

export const projectStatuses = ["Planning", "On track", "At risk"] as const satisfies readonly ProjectStatus[];

export const idSchema = z.uuid();
export const workspaceSchema = z.object({ name: z.string().trim().min(1, "Enter a workspace name.").max(80, "Use at most 80 characters.") });
export const memberRoleSchema = z.enum(["admin", "member"]);
export const invitationSchema = z.object({
  workspaceId: idSchema,
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: memberRoleSchema,
});
export const projectSchema = z.object({
  workspace_id: idSchema,
  name: z.string().trim().min(1, "Enter a project name.").max(100, "Use at most 100 characters."),
  description: z.string().trim().max(2000, "Use at most 2,000 characters for the description."),
  status: z.enum(projectStatuses),
  deadline: z.union([z.iso.date().refine((date) => !date.startsWith("0000")), z.literal("")]).transform((value) => value || null),
  progress: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(0).max(100)),
});
