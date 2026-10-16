import { z } from "zod";

export const WORKSPACE_NAME_MAX = 80;

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(WORKSPACE_NAME_MAX),
  // Normalized to a bare domain by the service, which refuses anything else.
  website: z.string().trim().min(1, "Website is required").max(255),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
