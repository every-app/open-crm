import { z } from "zod";

export const WORKSPACE_NAME_MAX = 120;

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(WORKSPACE_NAME_MAX),
  // A provided website is normalized to a bare domain by the service.
  website: z.string().trim().max(255),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
