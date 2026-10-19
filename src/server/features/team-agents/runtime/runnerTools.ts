import { RunSideEffects } from "@/server/features/team-agents/runtime/runSideEffects";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  asker,
  webResearchAccess,
} from "@/server/features/agent/lib/perplexity";
import type { Spend } from "@/server/features/agent/runtime/budget";
import { RECORD_KINDS } from "@/shared/records";
import { AGENT_ACTION_TYPES, type AgentManifest } from "@/shared/team-agents";
import { RunActions } from "./runActions";
import { webFetch } from "./webFetch";

// A team agent run's tools, ported from the CRM's agent_runner tools. Which
// tools exist follows the version: create_crm_activity only when it grants
// an activity type, post_slack_message only when it pins a Slack destination.
// Every call re-checks the grant itself (runActions.ts), so a tool the model
// somehow names without the grant still does nothing. No shell, no files, no
// questions: nobody is there to answer one.

type RunnerContext = {
  organizationId: string;
  runId: string;
  manifest: AgentManifest;
  spend: Spend;
};

export function runnerTools(context: RunnerContext): ToolSet {
  const { organizationId, runId, manifest } = context;
  const activityTypes = manifest.actions.flatMap((action) =>
    action.type === AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE
      ? action.activityTypes
      : [],
  );
  const postsToSlack = manifest.actions.some(
    (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
  );
  const [firstType, ...otherTypes] = activityTypes;
  return {
    inspect_run: tool({
      description:
        "Read this run's trigger and input, the version's approved record scope, captured sources and allowed actions, and the current time.",
      inputSchema: z.object({}),
      execute: () => RunActions.runContext(organizationId, runId),
    }),

    query_crm: tool({
      description:
        "Search contacts, companies and deals inside this version's approved CRM scope by name, email address or domain.",
      inputSchema: z.object({
        query: z.string().trim().min(2).max(160),
        kinds: z.array(z.enum(RECORD_KINDS)).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: (input) => RunActions.queryCrm(organizationId, runId, input),
    }),

    list_deals: tool({
      description:
        "List deals inside the approved scope by pipeline status and inactivity, the least recently touched first. Continue with nextOffset while it is not null.",
      inputSchema: z.object({
        status: z.enum(["open", "won", "lost", "all"]).default("open"),
        inactiveForDays: z.number().int().min(0).max(3650).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      execute: (input) => RunActions.listDeals(organizationId, runId, input),
    }),

    read_crm_record: tool({
      description:
        "Read one approved CRM record with its CRM history: the people, deals, notes and stage changes the CRM holds, and the captured email threads and meetings filed on it only when this version grants them.",
      inputSchema: z.object({
        kind: z.enum(RECORD_KINDS),
        id: z.string().min(1),
      }),
      execute: (input) => RunActions.readRecord(organizationId, runId, input),
    }),

    ...(firstType
      ? {
          create_crm_activity: tool({
            description: `Create an approved internal CRM ${activityTypes.map((type) => type.toLowerCase()).join(" or ")} on an approved record. The action is logged before it executes and happens once, however often the call is replayed.`,
            inputSchema: z.object({
              type: z.enum([firstType, ...otherTypes]),
              targetKind: z.enum(RECORD_KINDS),
              targetId: z.string().min(1),
              subject: z.string().trim().max(240).nullish(),
              body: z.string().trim().max(10_000).nullish(),
              dueAt: z
                .string()
                .nullish()
                .describe("For a task: when it is due, as an ISO date."),
            }),
            execute: (input, options) =>
              RunSideEffects.createActivity(
                organizationId,
                runId,
                options.toolCallId,
                input,
              ),
          }),
        }
      : {}),

    ...(postsToSlack
      ? {
          post_slack_message: tool({
            description:
              "Post one message to the Slack channel or person approved in the deployed version. The destination comes from the version, not from you, and the message is sent once however often the call is replayed.",
            inputSchema: z.object({
              text: z.string().trim().min(1).max(4_000),
            }),
            execute: (input, options) =>
              RunSideEffects.postSlackMessage(
                organizationId,
                runId,
                options.toolCallId,
                input,
              ),
          }),
        }
      : {}),

    web_search: tool({
      description:
        "Search the open web for public context (news, announcements, a company's own pages) and get a cited answer. Costs this run's budget. Never put customer text in the question.",
      inputSchema: z.object({
        question: z.string().trim().min(3).max(500),
      }),
      execute: async ({ question }) => {
        const research = await webResearchAccess();
        if (!research) {
          return {
            ok: false as const,
            reason:
              "Web search is not available on this install. Carry on with the CRM.",
          };
        }
        // A quick question, priced as research_person prices one.
        const charge = context.spend(1);
        if (!charge.ok) return { ok: false as const, reason: charge.reason };
        const answer = await asker(research)(question);
        return answer.ok
          ? { ok: true as const, ...answer.data }
          : { ok: false as const, reason: answer.reason };
      },
    }),

    web_fetch: webFetch,

    finish_run: tool({
      description:
        "Finish this run with its concise summary and a small structured result. Set noActionNeeded when the trigger fired but this run's condition was not met, so none of the declared actions applied: an agent that watches for something is expected to do nothing when that thing did not happen.",
      inputSchema: z.object({
        summary: z.string().trim().min(1).max(1000),
        result: z.record(z.string(), z.unknown()).nullish(),
        noActionNeeded: z
          .object({ reason: z.string().trim().min(1).max(500) })
          .nullish(),
      }),
      execute: (input) => RunActions.stageResult(organizationId, runId, input),
    }),
  };
}
