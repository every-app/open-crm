import { ownsCompanyStatus, ownsContactStatus } from "@/shared/agent-tasks";
import type { EnrichmentStatus } from "@/shared/crm-enums";
import {
  AgentRecordRepository,
  type StatusGuard,
} from "../repositories/AgentRecordRepository";
import {
  AgentTaskRepository,
  type TaskSubject,
} from "../repositories/AgentTaskRepository";

// A record's enrichment status follows the task that owns it, ported from the
// CRM's lib/enrichment.ts. Only some kinds own a status (identify, profile and
// recheck own the contact's; brand owns the company's). Settling only writes
// over a RUNNING row (or a stale PENDING one, once the task is over and no
// other request is open), so a task with nowhere to look leaves a PENDING
// record where the next sweep will find it.

function ownedColumns(subject: TaskSubject) {
  return {
    contactId:
      subject.contactId && ownsContactStatus(subject.kind)
        ? subject.contactId
        : null,
    companyId:
      subject.companyId && ownsCompanyStatus(subject.kind)
        ? subject.companyId
        : null,
  };
}

/** The task started: its record reads as researching, unless already done. */
export async function markRunning(subject: TaskSubject): Promise<void> {
  const owned = ownedColumns(subject);
  if (!owned.contactId && !owned.companyId) return;
  await AgentRecordRepository.setEnrichmentStatus(
    subject.organizationId,
    owned,
    "RUNNING",
    null,
    "unlessComplete",
  );
}

/** The task ended: its record takes `status` (and `error`, if it failed). */
export async function settle(
  subject: TaskSubject,
  status: EnrichmentStatus,
  error?: string,
): Promise<void> {
  const owned = ownedColumns(subject);
  if (!owned.contactId && !owned.companyId) return;
  await AgentRecordRepository.setEnrichmentStatus(
    subject.organizationId,
    owned,
    status,
    error ?? null,
    await settleable(subject, status),
  );
}

async function settleable(
  subject: TaskSubject,
  status: EnrichmentStatus,
): Promise<StatusGuard> {
  const from: EnrichmentStatus[] =
    status === "COMPLETE" ? ["RUNNING", "COMPLETE"] : ["RUNNING"];
  if (status !== "COMPLETE" && status !== "FAILED") return { statuses: from };
  const endedAt = await AgentTaskRepository.finishedAt(
    subject.organizationId,
    subject.id,
  );
  if (!endedAt) return { statuses: from };
  const reopened = await AgentTaskRepository.hasOtherOpen(
    subject.organizationId,
    subject,
    subject.id,
  );
  return reopened
    ? { statuses: from }
    : { statuses: from, pendingBefore: endedAt };
}
