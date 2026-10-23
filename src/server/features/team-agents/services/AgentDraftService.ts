import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { AppError } from "@/server/lib/errors";
import type { RecordRef } from "@/shared/records";
import { CAPTURE_GRANTS, type CaptureGrants } from "@/shared/team-agents";
import {
  AgentFileRepository,
  type NewArtifact,
} from "../repositories/AgentFileRepository";
import { AgentVersionRepository } from "../repositories/AgentVersionRepository";
import type { NewAudit } from "../repositories/AuditRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { TeamAgentRepository } from "../repositories/TeamAgentRepository";
import { manageableAgent } from "./access";
import {
  assertNoSecrets,
  draftIssues,
  FILE_LANGUAGES,
  manifestOf,
  versionFiles,
  type DraftInput,
} from "./draft";

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;
type Agent = NonNullable<
  Awaited<ReturnType<typeof TeamAgentRepository.findById>>
>;
type DraftContext = {
  organizationId: string;
  userId: string;
  conversationId: string | null;
  tagged: RecordRef[];
  agent: Agent | null;
  agentId?: string;
};

async function captureConnections(
  organizationId: string,
): Promise<CaptureGrants> {
  const sources = await ConnectionRepository.connectedSources(organizationId);
  return {
    email: CAPTURE_GRANTS.email.sources.some((source) => sources.has(source)),
    calendar: CAPTURE_GRANTS.calendar.sources.some((source) =>
      sources.has(source),
    ),
  };
}

async function saveFromClient(
  context: Context,
  input: { agentId: string; draft: DraftInput },
) {
  const found = await TeamAgentRepository.findById(
    context.organizationId,
    input.agentId,
  );
  const agent = found ? await manageableAgent(context, input.agentId) : null;
  try {
    return await saveDraft(
      {
        organizationId: context.organizationId,
        userId: context.userId,
        conversationId: null,
        tagged: input.draft.resources,
        agent,
        agentId: input.agentId,
      },
      input.draft,
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A simultaneous save may have claimed the id or version number. Never
    // attach writes to an id until it has been resolved in this organization.
    const held = await TeamAgentRepository.findById(
      context.organizationId,
      input.agentId,
    );
    if (held) {
      await manageableAgent(context, input.agentId);
      const latest = await AgentVersionRepository.latestVersion(
        context.organizationId,
        input.agentId,
      );
      if (
        latest &&
        sameVersion(latest, {
          instructions: input.draft.instructions,
          manifest: manifestOf(input.draft),
        })
      ) {
        return {
          saved: true as const,
          agentId: input.agentId,
          versionId: latest.id,
          versionNumber: latest.number,
          status: "READY" as const,
        };
      }
    }
    throw new AppError(
      "CONFLICT",
      "This agent changed while saving. Read it again, or use a new agent id for a new draft.",
    );
  }
}

function sameVersion(
  latest: {
    status: string;
    instructions: string;
    manifest: unknown;
  },
  input: { instructions: string; manifest: unknown },
): boolean {
  return (
    latest.status === "READY" &&
    latest.instructions === input.instructions &&
    JSON.stringify(latest.manifest) === JSON.stringify(input.manifest)
  );
}

/** Save an immutable review version; its triggers stay disabled until deployment. */
async function saveDraft(tool: DraftContext, input: DraftInput) {
  const { organizationId, userId, conversationId } = tool;
  const [tagged, slack, capture] = await Promise.all([
    BuilderRepository.describeRecords(organizationId, tool.tagged),
    SlackInventoryService.builderInventory(organizationId),
    captureConnections(organizationId),
  ]);
  const existing = await BuilderRepository.describeRecords(
    organizationId,
    input.resources,
  );
  const now = new Date();
  const issues = draftIssues(input, tagged, existing, { slack, capture }, now);
  if (issues.length > 0) {
    return {
      saved: false as const,
      issues,
      availableConnections: {
        slack: slack.connected,
        slackChannels: slack.channels,
        slackPeople: slack.people,
        email: capture.email,
        calendar: capture.calendar,
      },
    };
  }
  const manifest = manifestOf(input);
  const files = versionFiles(input, manifest);
  for (const file of files) assertNoSecrets(file.content);
  const agent = tool.agent;
  if (agent?.status === "DELETED") {
    throw new AppError("NOT_FOUND");
  }
  const agentId = agent?.id ?? tool.agentId ?? crypto.randomUUID();
  const latest = agent
    ? await AgentVersionRepository.latestVersion(organizationId, agentId)
    : null;
  if (
    latest &&
    sameVersion(latest, { instructions: input.instructions, manifest })
  ) {
    return {
      saved: true as const,
      agentId,
      versionId: latest.id,
      versionNumber: latest.number,
      status: "READY" as const,
    };
  }

  const versionId = crypto.randomUUID();
  const number = (latest?.number ?? 0) + 1;
  const working = conversationId
    ? await AgentFileRepository.conversationFiles(
        organizationId,
        conversationId,
      )
    : latest
      ? await AgentFileRepository.versionFiles(organizationId, latest.id)
      : [];
  const claimed: string[] = [];
  const artifacts: NewArtifact[] = [];
  for (const file of files) {
    const held = working.find((row) => row.path === file.path);
    if (
      held?.content === file.content &&
      held.status === "WRITING" &&
      !held.versionId
    ) {
      claimed.push(held.id);
      continue;
    }
    artifacts.push({
      id: crypto.randomUUID(),
      organizationId,
      conversationId,
      versionId,
      path: file.path,
      language: FILE_LANGUAGES[file.path],
      content: file.content,
      previousContent: held?.content ?? null,
      revision: (held?.revision ?? 0) + 1,
      status: "READY",
    });
  }
  const audit: NewAudit[] = [
    ...(agent
      ? []
      : [
          {
            organizationId,
            agentId,
            actorUserId: userId,
            actorType: "USER" as const,
            type: "agent.created",
            summary: conversationId
              ? "Created a draft agent from a private builder chat"
              : "Created a draft agent through MCP",
            requestId: conversationId
              ? `builder:${conversationId}`
              : `mcp:${agentId}`,
          },
        ]),
    {
      organizationId,
      agentId,
      versionId,
      actorUserId: userId,
      actorType: "USER",
      type: "version.created",
      summary: `Prepared version ${number} for review`,
      after: { status: "READY" },
      requestId: versionId,
    },
  ];
  await AgentVersionRepository.saveVersion({
    agent: agent
      ? undefined
      : {
          id: agentId,
          organizationId,
          name: input.name,
          description: input.description,
          createdById: userId,
          conversationId,
        },
    renameDraft:
      agent?.status === "DRAFT"
        ? { name: input.name, description: input.description }
        : undefined,
    version: {
      id: versionId,
      organizationId,
      agentId,
      number,
      status: "READY",
      instructions: input.instructions,
      manifest,
      sourceConversationId: conversationId,
      createdById: userId,
    },
    triggers: input.triggers.map((trigger) => ({
      id: crypto.randomUUID(),
      organizationId,
      agentId,
      versionId,
      type: trigger.type,
      name: trigger.name,
      summary: trigger.summary,
      event: trigger.type === "EVENT" ? trigger.event : null,
      intervalMinutes:
        trigger.type === "SCHEDULE" ? trigger.intervalMinutes : null,
      nextRunAt:
        trigger.type === "SCHEDULE"
          ? new Date(trigger.nextRunAt).toISOString()
          : null,
      enabled: false,
    })),
    artifacts,
    claimedArtifactIds: claimed,
    audit,
  });
  console.log("[team-agents] version saved", {
    organizationId,
    agentId,
    versionId,
    number,
  });
  return {
    saved: true as const,
    agentId,
    versionId,
    versionNumber: number,
    status: "READY" as const,
  };
}

export const AgentDraftService = {
  captureConnections,
  saveDraft,
  saveFromClient,
};
