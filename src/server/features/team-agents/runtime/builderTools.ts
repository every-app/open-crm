import { BuilderToolService } from "@/server/features/team-agents/services/BuilderToolService";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolContext } from "@/server/features/agent/tools/context";
import { conversationTools } from "@/server/features/agent/tools/conversation";
import { historyTools } from "@/server/features/agent/tools/history";
import { lookupTools } from "@/server/features/agent/tools/lookup";
import type { BuilderToolContext } from "../services/BuilderToolService";
import { BUILDER_FILE_PATHS, draftInputSchema } from "../services/draft";

// The agent builder's tools, ported from the CRM's agent_builder tools. It
// reads the CRM with the research agent's free read tools, and inspects what
// it may build with; writing files and saving a draft exist only in a turn
// the person opened with "/Create agent" (the CRM's CREATE_AGENT command),
// and close once a draft is saved. ask_question is the chat client's tool
// (src/client/features/team-agents/builderQuestion.ts).

export function builderTools(
  context: BuilderToolContext & {
    creating: boolean;
    agentContext: AgentToolContext;
  },
): ToolSet {
  const tool_ = context;
  let saved = false;
  const draftOpen = () => {
    if (saved) {
      throw new Error(
        "The draft is saved. Reply with its summary now and call no more tools.",
      );
    }
  };
  const reads = {
    ...lookupTools(context.agentContext),
    ...historyTools(context.agentContext),
    ...conversationTools(context.agentContext),
  };
  return {
    ...reads,
    inspect_context: tool({
      description:
        "Read the authoritative builder context: supported CRM events, connected sources, matched Slack people, available Slack channels, the records tagged in this chat, the current time, the limits, and the latest draft.",
      inputSchema: z.object({}),
      execute: () => BuilderToolService.builderContext(tool_),
    }),

    read_attachment: tool({
      description:
        "Read the text of a file the person attached in this chat, by its id.",
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: ({ id }) => BuilderToolService.readAttachment(tool_, id),
    }),

    ...(context.creating
      ? {
          write_agent_file: tool({
            description:
              "Write one working revision of an agent file so the person can follow the build. Write instructions, then the manifest, then the README, before saving the draft.",
            inputSchema: z.object({
              path: z.enum(BUILDER_FILE_PATHS),
              content: z.string().min(1).max(40_000),
            }),
            execute: async ({ path, content }) => {
              draftOpen();
              return BuilderToolService.writeFile(tool_, path, content);
            },
          }),

          save_agent_draft: tool({
            description:
              "Validate and save one immutable agent version for human review. Copy tagged CRM records exactly into resources; declare slack in integrations when the agent posts to Slack. This never deploys the agent.",
            inputSchema: draftInputSchema,
            execute: async (input) => {
              draftOpen();
              const result = await BuilderToolService.saveDraft(tool_, input);
              if (result.saved) saved = true;
              return result;
            },
          }),
        }
      : {}),
  };
}
