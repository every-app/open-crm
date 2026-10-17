import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AppError } from "@/server/lib/errors";
import type { RecordKind, RecordRef } from "@/shared/records";
import type { OpenAgentConversationInput } from "@/types/schemas/agent";
import {
  AgentConversationRepository,
  type RecordColumn,
} from "../repositories/AgentConversationRepository";
import { AgentEventRepository } from "../repositories/AgentEventRepository";
import { AgentRecordRepository } from "../repositories/AgentRecordRepository";
import { AgentTaskRepository } from "../repositories/AgentTaskRepository";
import { sessionName } from "../sessionName";
import { AgentAvailabilityService, taskHold } from "./AgentAvailabilityService";

// A person's conversations with the agent about a record, and what the agent
// has done there: what the Agent tab needs around the chat itself, which runs
// over /agents/crm-agent/<sessionId> (agentRoutes.ts). Conversations are the
// person's own; the record's research activity is the organization's.

/** The agents-client route name for CrmAgent: `useAgent({ agent, name })`. */
const AGENT_ROUTE = "crm-agent";

const COLUMN = {
  contact: "contactId",
  company: "companyId",
  deal: "dealId",
} as const satisfies Record<RecordKind, RecordColumn>;

type Context = Pick<EnsuredUserContext, "organizationId" | "userId">;

type ConversationRow = Awaited<
  ReturnType<typeof AgentConversationRepository.listForRecord>
>[number];

type AgentConversationSummary = ConversationRow & {
  agent: typeof AGENT_ROUTE;
  unread: boolean;
};

function summary(row: ConversationRow): AgentConversationSummary {
  return {
    ...row,
    agent: AGENT_ROUTE,
    unread: Boolean(
      row.lastAssistantAt &&
      (!row.lastReadAt || row.lastAssistantAt > row.lastReadAt),
    ),
  };
}

/**
 * The conversation to show for a record: the one asked for, else the
 * person's latest, else a new one (`fresh` always starts a new one). The
 * record must be the organization's.
 */
async function open(
  context: Context,
  input: OpenAgentConversationInput,
): Promise<AgentConversationSummary> {
  const { organizationId, userId } = context;
  const column = COLUMN[input.record.kind];
  const recordId = input.record.id;
  if (
    !(await AgentRecordRepository.recordExists(organizationId, input.record))
  ) {
    throw new AppError("NOT_FOUND");
  }
  if (input.conversationId) {
    const row = await AgentConversationRepository.findForRecord(
      organizationId,
      userId,
      column,
      recordId,
      input.conversationId,
    );
    if (!row) throw new AppError("NOT_FOUND");
    return summary(row);
  }
  if (!input.fresh) {
    const [latest] = await AgentConversationRepository.listForRecord(
      organizationId,
      userId,
      column,
      recordId,
      1,
    );
    if (latest) return summary(latest);
  }
  const created = await AgentConversationRepository.create({
    organizationId,
    userId,
    column,
    recordId,
    sessionId: sessionName("chat", organizationId, crypto.randomUUID()),
  });
  return summary(created);
}

async function list(
  context: Context,
  record: RecordRef,
): Promise<AgentConversationSummary[]> {
  const rows = await AgentConversationRepository.listForRecord(
    context.organizationId,
    context.userId,
    COLUMN[record.kind],
    record.id,
  );
  return rows.map(summary);
}

/**
 * What the agent did about a record (its research and the person's own
 * conversations, newest first) and what it is doing (open tasks), each
 * task with what holds it back, if anything.
 */
async function activity(context: Context, record: RecordRef, limit: number) {
  const column = COLUMN[record.kind];
  const [events, openTasks, hold] = await Promise.all([
    AgentEventRepository.listForRecord(
      context.organizationId,
      context.userId,
      column,
      record.id,
      limit,
    ),
    AgentTaskRepository.openForRecord(
      context.organizationId,
      column,
      record.id,
    ),
    AgentAvailabilityService.researchHold(context.organizationId),
  ]);
  return {
    // JSON columns come back as unknown; the client gets them as JSON.
    events: events.map((event) => ({
      ...event,
      data: eventData.parse(event.data),
    })),
    openTasks: openTasks.map(({ priority, ...task }) => ({
      ...task,
      hold: taskHold({ kind: task.kind, priority }, hold),
    })),
  };
}

const eventData = z.json().catch(null);

async function markRead(
  context: Context,
  conversationId: string,
): Promise<{ id: string }> {
  const read = await AgentConversationRepository.markRead(
    context.organizationId,
    context.userId,
    conversationId,
  );
  if (!read) throw new AppError("NOT_FOUND");
  return { id: conversationId };
}

/**
 * Deletes one of the person's conversations and the steps filed under it.
 * Returns its session, whose Durable Object still holds the messages.
 */
async function remove(
  context: Context,
  conversationId: string,
): Promise<{ id: string; sessionId: string }> {
  const removed = await AgentConversationRepository.remove(
    context.organizationId,
    context.userId,
    conversationId,
  );
  if (!removed) throw new AppError("NOT_FOUND");
  return removed;
}

export const AgentConversationService = {
  open,
  list,
  activity,
  markRead,
  remove,
};
