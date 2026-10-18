import { BuilderToolService } from "@/server/features/team-agents/services/BuilderToolService";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { mapValues } from "remeda";
import { z } from "zod";
import type { AgentToolContext } from "@/server/features/agent/tools/context";
import { QUESTION_PARAMETERS } from "@/shared/agent-question";
import { conversationTools } from "@/server/features/agent/tools/conversation";
import { fieldTools } from "@/server/features/agent/tools/fields";
import { historyTools } from "@/server/features/agent/tools/history";
import { lookupTools } from "@/server/features/agent/tools/lookup";
import { peopleTools } from "@/server/features/agent/tools/people";
import { researchTools } from "@/server/features/agent/tools/research";
import { socialTools } from "@/server/features/agent/tools/socials";
import type { BuilderToolContext } from "../services/BuilderToolService";
import { BUILDER_FILE_PATHS, draftInputSchema } from "../services/draft";
import { webFetch } from "./webFetch";

// The agent builder's tools, ported from the CRM's chat and agent_builder
// tools. Every turn reads the CRM with the research agent's free read tools
// and its custom fields, and inspects what it may build with. A question also
// gets the research agent's people and company research (the CRM's chat could
// research people and companies on the web), paid from the turn's budget, and
// the CRM chat's own web tools. Writing files and saving a draft exist only in
// a turn that asks for an agent, and close once a draft is saved; such a
// build has the CRM builder's 12 tool calls and 2 saves. ask_question has no
// server side: the turn parks on it and the chat asks it in place of the
// composer (src/shared/agent-question.ts). It is declared here, not by the
// chat client, so a turn the server started (a chat's first message) can ask
// too.

/**
 * The CRM chat's web_search: eve's built-in, which the model's provider runs.
 * The CRM's models go through Vercel's AI Gateway, where it is the gateway's
 * Parallel search; here it is OpenRouter's web search server tool on the same
 * engine and Parallel's ten results: OpenRouter searches inside the model
 * call, whose cost (usage accounting) includes the search, so the session's
 * meter bills it with the call.
 */
const webSearch = openrouter.tools.webSearch({
  engine: "parallel",
  maxResults: 10,
});

/**
 * The research a question may use, as the research agent has it: LinkedIn
 * lookups and open-web research about people, a company's site, and a
 * contact's other profiles. Without Context.dev or web research, each says so.
 * And the CRM chat's harness tools: reading a page, and searching the web.
 */
function chatResearch(context: AgentToolContext): ToolSet {
  return {
    ...peopleTools(context),
    research_company: researchTools(context).research_company,
    find_contact_socials: socialTools(context).find_contact_socials,
    web_fetch: webFetch,
    web_search: webSearch,
  };
}

/**
 * A build's tool calls and draft saves, as the CRM's builder capped them
 * (agent_builder/lib/execution-state.ts): past either, every call refuses.
 */
const BUILD_LIMITS = { toolCalls: 12, saves: 2 } as const;

/** `tools`, each call counted against a build's limits before it runs. */
function withinBuildLimits(tools: ToolSet): ToolSet {
  let calls = 0;
  let saves = 0;
  return mapValues(tools, (definition, name) => {
    const execute = definition.execute;
    if (!execute) return definition;
    return {
      ...definition,
      execute: (input: unknown, options: ToolExecutionOptions) => {
        calls += 1;
        if (calls > BUILD_LIMITS.toolCalls) {
          throw new Error("The agent builder exceeded its tool-call budget.");
        }
        if (name === "save_agent_draft") {
          saves += 1;
          if (saves > BUILD_LIMITS.saves) {
            throw new Error(
              "The agent builder exceeded its draft-save budget.",
            );
          }
        }
        const result: unknown = execute(input, options);
        return result;
      },
    };
  });
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
  const tools: ToolSet = {
    ...reads,
    ask_question: tool({
      description:
        "Ask the person one focused question when an essential choice blocks a safe draft: which inspected Slack channel or teammate, which schedule, or which outcome. Offer two to four inspected options, each with the inspected id as its id, a label without ids and what tells it apart, and allow a typed answer when a custom one is valid. Never ask for an id, a handle that inspect_context already resolves, or optional polish. Their answer comes back as this tool's output.",
      inputSchema: jsonSchema(QUESTION_PARAMETERS),
    }),
    inspect_context: tool({
      description:
        "Read the authoritative builder context: supported CRM events, connected sources, matched Slack people, available Slack channels, the records tagged in this chat, the current time, and the latest draft.",
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
  return context.creating ? withinBuildLimits(tools) : tools;
}
