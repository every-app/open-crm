import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";

export const workspaceTools = {
  get_workspace: crmTool({
    description:
      "The workspace this CRM belongs to: the company's name and website.",
    risk: "read",
    input: z.object({}).strict(),
    handler: (_input, context) =>
      WorkspaceService.getWorkspace(context.organizationId),
  }),
};
