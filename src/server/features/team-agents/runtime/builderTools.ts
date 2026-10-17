import { BuilderToolService } from "@/server/features/team-agents/services/BuilderToolService";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolContext } from "@/server/features/agent/tools/context";
import { conversationTools } from "@/server/features/agent/tools/conversation";
import { fieldTools } from "@/server/features/agent/tools/fields";
import { historyTools } from "@/server/features/agent/tools/history";
import { lookupTools } from "@/server/features/agent/tools/lookup";
import { peopleTools } from "@/server/features/agent/tools/people";
import { researchTools } from "@/server/features/agent/tools/research";
import { socialTools } from "@/server/features/agent/tools/socials";
import type { BuilderToolContext } from "../services/BuilderToolService";
import { BUILDER_FILE_PATHS, draftInputSchema } from "../services/draft";

// The agent builder's tools, ported from the CRM's chat and agent_builder
// tools. Every turn reads the CRM with the research agent's free read tools
// and its custom fields, and inspects what it may build with. A question also
// gets the research agent's people and company research (the CRM's chat could
// research people and companies on the web), paid from the turn's budget.
// Writing files and saving a draft exist only in a turn that asks for an
// agent, and close once a draft is saved. ask_question is the chat client's
// tool (src/client/features/team-agents/builderQuestion.ts).

/**
 * The research a question may use, as the research agent has it: LinkedIn
 * lookups and open-web research about people, a company's site, and a
 * contact's other profiles. Without Context.dev or web research, each says so.
 */
function chatResearch(context: AgentToolContext): ToolSet {
  return {
    ...peopleTools(context),
    research_company: researchTools(context).research_company,
    find_contact_socials: socialTools(context).find_contact_socials,
  };
}

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
    list_fields: fieldTools(context.agentContext).list_fields,
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
              "Validate and save one immutable agent version for human review. Copy tagged CRM records exactly into resources; declare slack in integrations when the agent posts to Slack, and email or calendar when it must read the captured mail or meetings on its records. This never deploys the agent.",
            inputSchema: draftInputSchema,
            execute: async (input) => {
              draftOpen();
              const result = await BuilderToolService.saveDraft(tool_, input);
              if (result.saved) saved = true;
              return result;
            },
          }),
        }
      : chatResearch(context.agentContext)),
  };
}
