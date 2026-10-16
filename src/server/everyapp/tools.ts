import {
  ToolError,
  defineTools,
  everyApp,
  type EveryAppUser,
  type ToolDefinition,
} from "@every-app/sdk/server";
import { z } from "zod";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { asAppError } from "@/server/lib/errors";
import {
  forOrganization,
  serveEveryAppRequest,
} from "@/server/lib/gateway-attribution";

// The CRM's tools, served by the Every App gateway: its one MCP connector
// lists them as `crm_<tool>` beside every other app's, and this app's own
// host serves them under their names. The gateway signs in the person,
// applies the connection's read-only or read-write choice, and calls a tool
// here with a verified identity; the CRM never speaks MCP itself.

const INSTRUCTIONS =
  "The CRM's companies, contacts and deals. Never guess record ids: search or list first. Everything is scoped to the caller's organization.";

type CrmToolHandler<Input> = (
  input: Input,
  context: EnsuredUserContext,
) => Promise<unknown>;

/**
 * One CRM tool: the handler runs as the caller, in the organization their
 * signed identity names, with every gateway call it makes attributed to it
 * (gateway-attribution.ts). AppErrors reach the model as their message.
 */
export function crmTool<Schema extends z.ZodObject>(definition: {
  description: string;
  risk: ToolDefinition["risk"];
  input: Schema;
  handler: CrmToolHandler<z.infer<Schema>>;
}): ToolDefinition {
  return {
    description: definition.description,
    risk: definition.risk,
    input: definition.input,
    handler: async (args, { user, request }) =>
      serveEveryAppRequest(request, user, async () => {
        const context = await resolveContext(user);
        try {
          return await forOrganization(context.organizationId, () =>
            definition.handler(
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK validated args against this tool's own input schema before calling
              args as z.infer<Schema>,
              context,
            ),
          );
        } catch (error) {
          const appError = asAppError(error);
          if (appError) throw new ToolError(appError.message);
          throw error;
        }
      }),
  };
}

function resolveContext(user: EveryAppUser): Promise<EnsuredUserContext> {
  return resolveEveryAppUserContext(user);
}

const workspaceTools = {
  get_workspace: crmTool({
    description:
      "The workspace this CRM belongs to: the company's name and website.",
    risk: "read",
    input: z.object({}).strict(),
    handler: (_input, context) =>
      WorkspaceService.getWorkspace(context.organizationId),
  }),
};

/**
 * Answers the gateway's tools contract (`/__everyapp/tools/*`): the catalog
 * at deploy, and each call. Loaded on the first tools request only.
 */
export const everyAppTools = everyApp<Env>(
  () => new Response("Not found", { status: 404 }),
  {
    tools: defineTools({ ...workspaceTools }, { instructions: INSTRUCTIONS }),
  },
);
