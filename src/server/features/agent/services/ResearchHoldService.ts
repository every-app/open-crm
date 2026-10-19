import { FieldsService } from "@/server/features/fields/services/FieldsService";
import type { RecordSource } from "@/shared/crm-enums";
import {
  ResearchHoldRepository,
  type HeldKind,
} from "../repositories/ResearchHoldRepository";
import { AgentTaskService } from "./AgentTaskService";

// Research that waits for a person. Anyone can make the CRM add records: a
// website form files a contact and its company, and a calendar invite adds
// its attendee and their company. Those get no paid research (no identify,
// company profile, brand lookup or agent-filled fields) until a person
// opens one or asks for it. Their free favicons still come (the enrichment
// sweep's own pass), and team agents still get their CRM events, the
// organization's own automation. Records a CSV import added with "Research
// new records" off wait for a person to ask. The enrichment sweep passes
// over every held record (AgentSweepRepository).

/** The sources anyone can use: a person opening their records releases them. */
const STRANGERS: readonly RecordSource[] = ["TRACKING", "CALENDAR"];

const ADDED_FROM: Partial<Record<RecordSource, string>> = {
  TRACKING: "a website form",
  CALENDAR: "a calendar invite",
};

const ENTITY = { company: "COMPANY", contact: "CONTACT" } as const;

/**
 * When a new record from `source` has its research held: now for a website
 * form's or a calendar invite's, else never.
 */
function heldFrom(source: RecordSource | undefined): string | null {
  return source && STRANGERS.includes(source) ? new Date().toISOString() : null;
}

/**
 * A person opened the record (its sheet, or their AI client read it). One a
 * website form or a calendar invite added now gets the research a record a
 * person adds gets.
 */
async function opened(
  organizationId: string,
  kind: HeldKind,
  record: { id: string; source: RecordSource; researchHeldAt: string | null },
): Promise<void> {
  if (record.researchHeldAt === null || !STRANGERS.includes(record.source)) {
    return;
  }
  if (!(await ResearchHoldRepository.release(organizationId, kind, record.id)))
    return;
  const reason = `Added from ${ADDED_FROM[record.source] ?? "outside"}, then opened by a person`;
  if (kind === "company") {
    await AgentTaskService.companyCreated(organizationId, record.id, reason);
  } else {
    await AgentTaskService.contactCreated(organizationId, record.id, reason);
  }
  await FieldsService.queueFillForNewRecord(
    organizationId,
    ENTITY[kind],
    record.id,
  );
}

/**
 * A person asked for the record's research (Enrich), which they queued: the
 * custom fields the agent fills, held with it, come too.
 */
async function asked(
  organizationId: string,
  kind: HeldKind,
  id: string,
): Promise<void> {
  if (!(await ResearchHoldRepository.release(organizationId, kind, id))) return;
  await FieldsService.queueFillForNewRecord(organizationId, ENTITY[kind], id);
}

/** Records a CSV import added with research off: they wait for a person. */
async function imported(
  organizationId: string,
  created: { companyIds: string[]; contactIds: string[] },
): Promise<void> {
  await ResearchHoldRepository.hold(
    organizationId,
    "company",
    created.companyIds,
  );
  await ResearchHoldRepository.hold(
    organizationId,
    "contact",
    created.contactIds,
  );
}

export const ResearchHoldService = { heldFrom, opened, asked, imported };
