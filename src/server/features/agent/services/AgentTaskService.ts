import { z } from "zod";
import { FIELD_ENTITIES, type FieldEntity } from "@/shared/crm-enums";
import { PRIORITY, taskSubject } from "@/shared/agent-tasks";
import {
  AgentTaskRepository,
  type NewAgentTask,
} from "@/server/features/agent/repositories/AgentTaskRepository";
import { pokeDispatcher } from "@/server/features/agent/poke";

// How the rest of the CRM hands the research agent work: a row in its queue
// (agent_task), which the minute cron leases (src/server/features/agent/
// dispatch.ts). Queueing never fails a person's request unless they asked for
// the work themselves (`required`).

type TaskInput = Omit<NewAgentTask, "organizationId" | "subject"> & {
  subject?: string;
};

async function enqueue(
  organizationId: string,
  task: TaskInput,
  required = false,
): Promise<boolean> {
  try {
    const created = await AgentTaskRepository.insertIfAbsent({
      ...task,
      organizationId,
      subject: task.subject ?? taskSubject(task),
    });
    if (created) {
      console.log("[agent] task queued", {
        organizationId,
        kind: task.kind,
        contactId: task.contactId ?? undefined,
        companyId: task.companyId ?? undefined,
      });
      pokeDispatcher(organizationId);
    }
    return created;
  } catch (error) {
    console.error("[agent] could not queue task", { kind: task.kind }, error);
    if (required) throw error;
    return false;
  }
}

/** A company was added: fetch its brand, then write its profile. */
async function companyCreated(
  organizationId: string,
  companyId: string,
  reason = "New company",
): Promise<void> {
  await enqueue(organizationId, {
    companyId,
    kind: "brand",
    reason,
    priority: PRIORITY.brand,
    budget: 2,
  });
  await enqueue(organizationId, {
    companyId,
    kind: "company-profile",
    reason,
    priority: PRIORITY.companyProfile,
    budget: 4,
  });
}

/** A person asked to enrich a company now. True when anything was queued. */
async function companyRequested(
  organizationId: string,
  companyId: string,
  reason: string,
): Promise<boolean> {
  const brand = await enqueue(
    organizationId,
    {
      companyId,
      kind: "brand",
      reason,
      priority: PRIORITY.brand,
      budget: 2,
    },
    true,
  );
  const profile = await enqueue(
    organizationId,
    {
      companyId,
      kind: "company-profile",
      reason,
      priority: PRIORITY.requested,
      budget: 8,
    },
    true,
  );
  return brand || profile;
}

/** The workspace's own website was set or changed: learn the business. */
async function workspaceChanged(
  organizationId: string,
  website: string,
  reason: string,
): Promise<void> {
  await enqueue(organizationId, {
    kind: "workspace-profile",
    reason: `${reason} (${website})`,
    priority: PRIORITY.workspace,
    budget: 4,
  });
}

/**
 * A contact was added (or a person asked to identify one: `required`, which
 * also puts it with the work people asked for, so it runs even where a
 * first-party deployment holds its scheduled research).
 */
async function contactCreated(
  organizationId: string,
  contactId: string,
  reason: string,
  required = false,
): Promise<boolean> {
  return enqueue(
    organizationId,
    {
      contactId,
      kind: "identify",
      reason,
      priority: required ? PRIORITY.requested : PRIORITY.identify,
      budget: 4,
    },
    required,
  );
}

/** Queues `kind` for each record that has no open task of that kind. */
async function backfill(
  organizationId: string,
  input: {
    kind: string;
    reason: string;
    contactIds?: string[];
    companyIds?: string[];
    budget?: number;
    priority?: number;
  },
): Promise<{ queued: number; alreadyQueued: number }> {
  const byContact = Boolean(input.contactIds);
  const ids = [...new Set(input.contactIds ?? input.companyIds ?? [])];
  if (ids.length === 0) return { queued: 0, alreadyQueued: 0 };
  let queued = 0;
  for (const id of ids) {
    const created = await AgentTaskRepository.insertIfAbsent({
      organizationId,
      contactId: byContact ? id : null,
      companyId: byContact ? null : id,
      subject: taskSubject(byContact ? { contactId: id } : { companyId: id }),
      kind: input.kind,
      reason: input.reason,
      priority: input.priority ?? PRIORITY.sweep,
      budget: input.budget ?? 4,
    });
    if (created) queued += 1;
  }
  if (queued > 0) pokeDispatcher(organizationId);
  return { queued, alreadyQueued: ids.length - queued };
}

export const fieldBackfillPayloadSchema = z.object({
  entity: z.enum(FIELD_ENTITIES),
  keys: z.array(z.string()),
});

const RECORD_COLUMN = {
  COMPANY: "companyId",
  CONTACT: "contactId",
  DEAL: "dealId",
} as const satisfies Record<FieldEntity, keyof TaskInput>;

/**
 * Asks the agent to fill custom fields (`keys`) on each record. A record that
 * already has an open backfill gets the new keys merged into it.
 */
async function fieldBackfillRecords(
  organizationId: string,
  entity: FieldEntity,
  keys: string[],
  ids: string[],
  reason: string,
): Promise<{ queued: number; merged: number }> {
  if (ids.length === 0 || keys.length === 0) return { queued: 0, merged: 0 };
  const column = RECORD_COLUMN[entity];
  let queued = 0;
  let merged = 0;
  for (const id of new Set(ids)) {
    const record = { [column]: id };
    const subject = taskSubject(record);
    const created = await AgentTaskRepository.insertIfAbsent({
      organizationId,
      ...record,
      subject,
      kind: "field-backfill",
      reason,
      priority: PRIORITY.fieldBackfill,
      budget: 8,
      payload: { entity, keys },
    });
    if (created) {
      queued += 1;
      continue;
    }
    const pending = await AgentTaskRepository.findOpen(
      organizationId,
      "field-backfill",
      subject,
    );
    if (!pending) continue;
    const parsed = fieldBackfillPayloadSchema.safeParse(pending.payload);
    const priorKeys = parsed.success ? parsed.data.keys : [];
    const nextKeys = [...new Set([...priorKeys, ...keys])];
    if (nextKeys.length === priorKeys.length) continue;
    if (
      await AgentTaskRepository.replaceOpenPayload(organizationId, pending.id, {
        entity,
        keys: nextKeys,
      })
    ) {
      merged += 1;
    }
  }
  if (queued > 0) pokeDispatcher(organizationId);
  return { queued, merged };
}

export const AgentTaskService = {
  companyCreated,
  companyRequested,
  workspaceChanged,
  contactCreated,
  backfill,
  fieldBackfillRecords,
};
