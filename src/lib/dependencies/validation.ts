import { z } from "zod";
import { idSchema } from "@/lib/workspaces/validation";

export const dependencyInputSchema = z.object({
  workspaceId: idSchema,
  projectId: idSchema,
  sourceId: idSchema,
  targetId: idSchema,
}).refine((input) => input.sourceId !== input.targetId, { message: "A task cannot depend on itself." });
