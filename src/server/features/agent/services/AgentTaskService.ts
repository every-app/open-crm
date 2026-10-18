import { z } from "zod";
import { FIELD_ENTITIES, type FieldEntity } from "@/shared/crm-enums";
import {
  DIRECT_KINDS,
  PRIORITY,
  SLACK_SYNC_KIND,
  taskSubject,
} from "@/shared/agent-tasks";
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
      // A logo or a photo is fetched at once; research waits for the cron.
      if ((DIRECT_KINDS as readonly string[]).includes(task.kind)) {
        pokeDispatcher(organizationId);
      }
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

/**
 * A person added a company, or gave one a new domain: as companyCreated, and
 * its favicon at once, as the CRM fetched it then (companies.service.ts). The
 * favicon is free, so it waits for neither the queue nor credits.
 */
async function companyAddedByPerson(
  organizationId: string,
  companyId: string,
  reason?: string,
): Promise<void> {
  await companyCreated(organizationId, companyId, reason);
  pokeDispatcher(organizationId, companyId);
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

/**
 * Read Slack's people and channels again (the CRM's slackPeopleRequested).
 * True when it was queued; false when a read is already queued or running.
 */
async function slackSyncRequested(
  organizationId: string,
  required: boolean,
): Promise<boolean> {
  return enqueue(
    organizationId,
    {
      kind: SLACK_SYNC_KIND,
      reason: "Read Slack's people and channels",
      priority: PRIORITY.slackSync,
      budget: 0,
    },
    required,
  );
}

/**
 * A captured meeting within a week has a contact the agent has written no
 * brief on: get the record ready before it (the CRM's meetingSoon).
 */
async function meetingSoon(
  organizationId: string,
  contactId: string,
  startsAt: string,
): Promise<void> {
  await enqueue(organizationId, {
    contactId,
    kind: "meeting-prep",
    reason: `Meeting on ${new Date(startsAt).toDateString()} with someone we know nothing about`,
    priority: PRIORITY.meeting,
    budget: 10,
  });
}

/**
 * Queues `kind` for each record that has no open task of that kind (the
 * CRM's backfill, which the enrichment sweep runs), in batched writes. The
 * minute cron's lanes take it from there: a sweep of twenty organizations
 * doesn't start a lane for each.
 */
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
  const subjectOf = (id: string) =>
    taskSubject(byContact ? { contactId: id } : { companyId: id });
  const open = await AgentTaskRepository.openBySubjects(
    organizationId,
    input.kind,
    ids.map(subjectOf),
  );
  const taken = new Set(open.map((task) => task.subject));
  const fresh = ids.filter((id) => !taken.has(subjectOf(id)));
  await AgentTaskRepository.upsertMany(
    fresh.map((id) => ({
      organizationId,
      contactId: byContact ? id : null,
      companyId: byContact ? null : id,
      subject: subjectOf(id),
      kind: input.kind,
      reason: input.reason,
      priority: input.priority ?? PRIORITY.sweep,
      budget: input.budget ?? 4,
    })),
  );
  return { queued: fresh.length, alreadyQueued: ids.length - fresh.length };
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
 * already has an open backfill gets the new keys merged into it. A few
 * batched queries per chunk of records rather than a few per record, so a
 * large fill stays inside a Worker invocation's query budget.
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
  const records = [...new Set(ids)].map((id) => ({
    record: { [column]: id },
    subject: taskSubject({ [column]: id }),
  }));
  let queued = 0;
  let merged = 0;
  for (let i = 0; i < records.length; i += BACKFILL_CHUNK) {
    const chunk = records.slice(i, i + BACKFILL_CHUNK);
    const open = await AgentTaskRepository.openBySubjects(
      organizationId,
      "field-backfill",
      chunk.map(({ subject }) => subject),
    );
    const openBySubject = new Map(open.map((task) => [task.subject, task]));
    const fresh = chunk.filter(({ subject }) => !openBySubject.has(subject));
    const merges = open.flatMap((task) => {
      const parsed = fieldBackfillPayloadSchema.safeParse(task.payload);
      const priorKeys = parsed.success ? parsed.data.keys : [];
      const nextKeys = [...new Set([...priorKeys, ...keys])];
      return nextKeys.length === priorKeys.length
        ? []
        : [{ id: task.id, payload: { entity, keys: nextKeys } }];
    });
    await AgentTaskRepository.upsertMany(
      fresh.map(({ record, subject }) => ({
        organizationId,
        ...record,
        subject,
        kind: "field-backfill",
        reason,
        priority: PRIORITY.fieldBackfill,
        budget: 8,
        payload: { entity, keys },
      })),
    );
    await AgentTaskRepository.replaceOpenPayloads(organizationId, merges);
    queued += fresh.length;
    merged += merges.length;
  }
  if (queued > 0) pokeDispatcher(organizationId);
  return { queued, merged };
}

const BACKFILL_CHUNK = 90;

/**
 * How far apart research for imported records is booked: two records a
 * minute, so a 5,000-row import trickles through the research lane over
 * about two days instead of taking it (and its spend) over at once.
 */
const IMPORT_RESEARCH_SPACING_MS = 30_000;

/** Records a CSV import created, by kind, and the custom fields the agent fills on each kind. */
type ImportedRecords = {
  entity: FieldEntity;
  ids: string[];
  agentFilledKeys: string[];
}[];

/**
 * Records a CSV import created: the same work a person adding them queues,
 * paced. A company's logo (no model) comes at once, after a person's own
 * adds. Everything that needs the model (a company's profile, identifying a
 * contact, the custom fields the agent fills) is booked at the lowest
 * priority but rechecks, one record every IMPORT_RESEARCH_SPACING_MS after
 * any earlier import's bookings. Where a first-party deployment holds
 * scheduled research, that research waits for a person to ask, as all
 * scheduled research does there.
 */
async function recordsImported(
  organizationId: string,
  imported: ImportedRecords,
): Promise<void> {
  const latest = await AgentTaskRepository.latestOpenDue(
    organizationId,
    PRIORITY.imported,
  );
  let slot = Math.max(Date.now(), latest ? Date.parse(latest) : 0);
  const nextSlot = () => {
    slot += IMPORT_RESEARCH_SPACING_MS;
    return new Date(slot).toISOString();
  };
  const reason = "Imported from a CSV";
  const tasks: NewAgentTask[] = [];
  let brands = 0;
  for (const { entity, ids, agentFilledKeys } of imported) {
    const column = RECORD_COLUMN[entity];
    for (const id of new Set(ids)) {
      const record = { [column]: id };
      const subject = taskSubject(record);
      const research: Omit<NewAgentTask, "dueAt">[] = [];
      if (entity === "COMPANY") {
        tasks.push({
          organizationId,
          ...record,
          subject,
          kind: "brand",
          reason,
          priority: PRIORITY.importedBrand,
          budget: 2,
        });
        brands += 1;
        research.push({
          organizationId,
          ...record,
          subject,
          kind: "company-profile",
          reason,
          priority: PRIORITY.imported,
          budget: 4,
        });
      }
      if (entity === "CONTACT") {
        research.push({
          organizationId,
          ...record,
          subject,
          kind: "identify",
          reason,
          priority: PRIORITY.imported,
          budget: 4,
        });
      }
      if (agentFilledKeys.length > 0) {
        research.push({
          organizationId,
          ...record,
          subject,
          kind: "field-backfill",
          reason,
          priority: PRIORITY.imported,
          budget: 8,
          payload: { entity, keys: agentFilledKeys },
        });
      }
      if (research.length === 0) continue;
      const dueAt = nextSlot();
      tasks.push(...research.map((task) => ({ ...task, dueAt })));
    }
  }
  if (tasks.length === 0) return;
  await AgentTaskRepository.upsertMany(tasks);
  console.log("[agent] queued imported records", {
    organizationId,
    tasks: tasks.length,
    lastDue: new Date(slot).toISOString(),
  });
  if (brands > 0) pokeDispatcher(organizationId);
}

export const AgentTaskService = {
  companyCreated,
  companyAddedByPerson,
  companyRequested,
  workspaceChanged,
  contactCreated,
  meetingSoon,
  slackSyncRequested,
  backfill,
  fieldBackfillRecords,
  recordsImported,
};
