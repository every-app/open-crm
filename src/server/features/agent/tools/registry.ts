import type { Tool, ToolSet } from "ai";
import { withPgClient } from "@/db";
import { forOrganization } from "@/server/lib/gateway-attribution";
import { capToolOutput } from "../runtime/toolOutput";
import type { AgentToolContext, ToolGroup } from "./context";
import { conversationTools } from "./conversation";
import { factTools } from "./facts";
import { fieldTools } from "./fields";
import { historyTools } from "./history";
import { lookupTools } from "./lookup";
import { peopleTools } from "./people";
import { recordTools } from "./records";
import { researchTools } from "./research";
import { socialTools } from "./socials";
import { webTools } from "./web";

// The agent's tools, built per session turn from what the session is
// (tools/context.ts). A new family of tools is a ToolGroup added to this list.
const TOOL_GROUPS: readonly ToolGroup[] = [
  historyTools,
  lookupTools,
  recordTools,
  factTools,
  researchTools,
  peopleTools,
  socialTools,
  webTools,
  fieldTools,
  conversationTools,
];

export function buildAgentTools(context: AgentToolContext): ToolSet {
  const tools: ToolSet = {};
  for (const group of TOOL_GROUPS) Object.assign(tools, group(context));
  return scopeTools(context, tools);
}

/** `tools`, each run as the session's organization (scoped, below). */
export function scopeTools(
  context: Pick<AgentToolContext, "organizationId" | "sessionId">,
  tools: ToolSet,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      scoped(context, definition),
    ]),
  );
}

/**
 * Runs a tool as the session's organization: its database client scoped for
 * the call (tool calls run inside Think's loop, outside any request), every
 * gateway call it makes named for the organization, its output capped, and a
 * failure handed to the model to work around rather than ending the turn.
 */
function scoped(
  context: Pick<AgentToolContext, "organizationId" | "sessionId">,
  definition: Tool,
): Tool {
  const execute = definition.execute;
  if (!execute) return definition;
  return {
    ...definition,
    execute: async (input: unknown, options) => {
      try {
        const output = await withPgClient(() =>
          forOrganization(
            context.organizationId,
            async (): Promise<unknown> => {
              const result: unknown = await execute(input, options);
              return result;
            },
          ),
        );
        return capToolOutput(output);
      } catch (error) {
        console.warn("[agent] tool failed", {
          sessionId: context.sessionId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
