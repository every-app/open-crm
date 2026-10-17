import type { Tool, ToolSet } from "ai";
import { withPgClient } from "@/db";
import { forOrganization } from "@/server/lib/gateway-attribution";
import { capToolOutput } from "../runtime/toolOutput";
import type { AgentToolContext, ToolGroup } from "./context";
import { conversationTools } from "./conversation";
import { factTools } from "./facts";
import { historyTools } from "./history";
import { lookupTools } from "./lookup";
import { recordTools } from "./records";
import { researchTools } from "./research";
import { webTools } from "./web";

// The agent's tools, built per session turn from what the session is
// (tools/context.ts). A new family of tools is a ToolGroup added to this list.
const TOOL_GROUPS: readonly ToolGroup[] = [
  historyTools,
  lookupTools,
  recordTools,
  factTools,
  researchTools,
  webTools,
  conversationTools,
];

export function buildAgentTools(context: AgentToolContext): ToolSet {
  const tools: ToolSet = {};
  for (const group of TOOL_GROUPS) {
    for (const [name, definition] of Object.entries(group(context))) {
      tools[name] = scoped(context, definition);
    }
  }
  return tools;
}

/**
 * Runs a tool as the session's organization: its database client scoped for
 * the call (tool calls run inside Think's loop, outside any request), every
 * gateway call it makes named for the organization, its output capped, and a
 * failure handed to the model to work around rather than ending the turn.
 */
function scoped(context: AgentToolContext, definition: Tool): Tool {
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
