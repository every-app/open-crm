import { AgentAccountRepository } from "@/server/features/agent/repositories/AgentAccountRepository";
import { AgentDealRepository } from "@/server/features/agent/repositories/AgentDealRepository";
import { AgentHistoryRepository } from "@/server/features/agent/repositories/AgentHistoryRepository";
import { AgentLookupRepository } from "@/server/features/agent/repositories/AgentLookupRepository";
import { searchCrm } from "@/server/features/agent/tools/lookup";
import { RECORD_KINDS, type RecordKind } from "@/shared/records";
import {
  agentManifest,
  CAPTURE_KINDS,
  captureGrants,
  recordResources,
  type AgentManifest,
  type RecordResource,
} from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { RunSettlement } from "../services/RunSettlement";

// What a team agent's run may read, ported from the CRM's run-runtime.ts.
// Each function re-reads the run and its pinned version and enforces the
// version's grants itself, whatever the model asked: records only inside the
// approved scope, captured email and meetings only when the version grants
// them, and nothing at all once the run is no longer RUNNING. What it may do
// outside itself is runSideEffects.ts.

export class RunRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunRefusal";
  }
}

type Scope = { mode: "SELECTED" | "WORKSPACE"; records: RecordResource[] };

/** The manifest, or a refusal: a run never guesses at what it may do. */
function readManifest(value: unknown): AgentManifest {
  const parsed = agentManifest.safeParse(value);
  if (!parsed.success) {
    throw new RunRefusal(
      "This version's manifest is unreadable, so it cannot run. Revise and deploy the agent again.",
    );
  }
  return parsed.data;
}

/** The version's record scope, failing closed on a contradictory one. */
function scopeOf(manifest: AgentManifest): Scope {
  const records = recordResources(manifest.dataScope.resources);
  if (manifest.dataScope.mode === "SELECTED" && records.length === 0) {
    throw new RunRefusal("This version selected no CRM records.");
  }
  if (manifest.dataScope.mode === "WORKSPACE" && records.length > 0) {
    throw new RunRefusal("This version mixes workspace and selected scope.");
  }
  return { mode: manifest.dataScope.mode, records };
}

export function inScope(scope: Scope, kind: RecordKind, id: string): boolean {
  return (
    scope.mode === "WORKSPACE" ||
    scope.records.some((record) => record.kind === kind && record.id === id)
  );
}

/** The run, while it is RUNNING, with its version's manifest and scope. */
export async function activeRun(organizationId: string, runId: string) {
  const run = await AgentRunRepository.findWithVersion(organizationId, runId);
  if (!run) throw new RunRefusal("This agent run is unavailable.");
  if (run.status !== "RUNNING") {
    throw new RunRefusal("This agent run is not active.");
  }
  const manifest = readManifest(run.manifest);
  return { run, manifest, scope: scopeOf(manifest) };
}

/** What inspect_run returns: the pinned version, trigger, grants and time. */
async function runContext(organizationId: string, runId: string) {
  const { run, manifest, scope } = await activeRun(organizationId, runId);
  return {
    run: { id: run.id, triggerType: run.triggerType, input: run.input },
    agent: { name: run.agentName, description: run.agentDescription },
    version: { number: run.versionNumber },
    triggers: manifest.triggers,
    recordScope: scope.mode,
    allowedRecords: scope.records,
    capturedSources: captureGrants(manifest.dataScope.resources),
    allowedActions: manifest.actions,
    now: new Date().toISOString(),
  };
}

/** Search inside the approved scope. */
async function queryCrm(
  organizationId: string,
  runId: string,
  input: { query: string; kinds?: RecordKind[]; limit: number },
) {
  const { scope } = await activeRun(organizationId, runId);
  const result = await searchCrm(
    { organizationId },
    input.query,
    input.kinds ?? [...RECORD_KINDS],
    input.limit,
  );
  if (scope.mode === "WORKSPACE") return result;
  const contacts = result.contacts.filter((row) =>
    inScope(scope, "contact", row.id),
  );
  const companies = result.companies.filter((row) =>
    inScope(scope, "company", row.id),
  );
  const deals = result.deals.filter((row) => inScope(scope, "deal", row.id));
  return {
    ...result,
    contacts,
    companies,
    deals,
    total: contacts.length + companies.length + deals.length,
  };
}

/** Deals by pipeline status and inactivity, inside the approved scope. */
async function listDeals(
  organizationId: string,
  runId: string,
  input: {
    status: "open" | "won" | "lost" | "all";
    inactiveForDays?: number;
    limit: number;
    offset: number;
  },
) {
  const { scope } = await activeRun(organizationId, runId);
  const now = new Date();
  const rows = await AgentLookupRepository.listDeals(
    organizationId,
    input,
    now,
  );
  const hasMore = rows.length > input.limit;
  const deals = rows
    .slice(0, input.limit)
    .filter((row) => inScope(scope, "deal", row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      stage: row.stage,
      amount: row.amount,
      currency: row.currency,
      company: { id: row.companyId, name: row.companyName },
      owner: row.ownerName ?? row.ownerEmail,
      lastActivityAt: row.lastActivityAt,
      expectedCloseDate: row.expectedCloseDate,
      createdAt: row.createdAt,
    }));
  return {
    asOf: now.toISOString(),
    deals,
    nextOffset: hasMore ? input.offset + input.limit : null,
  };
}

const WITHHELD = {
  email: "Captured email is not granted to this version: no threads were read.",
  calendar:
    "Captured meetings are not granted to this version: no meetings were read.",
} as const;

/**
 * One record and its CRM history, inside the approved scope, with the
 * captured email threads and meetings filed on it only when the version
 * grants them (CAPTURE_GRANTS). An ungranted source is never read, so its
 * lists come back empty and its counts null.
 */
async function readRecord(
  organizationId: string,
  runId: string,
  input: { kind: RecordKind; id: string },
) {
  const { scope, manifest } = await activeRun(organizationId, runId);
  if (!inScope(scope, input.kind, input.id)) {
    throw new RunRefusal(
      "That CRM record is outside this agent version's approved scope.",
    );
  }
  const sources = captureGrants(manifest.dataScope.resources);
  const history =
    input.kind === "contact"
      ? await AgentHistoryRepository.contactHistory(organizationId, input.id, {
          threads: 10,
          ...sources,
        })
      : input.kind === "company"
        ? await AgentAccountRepository.companyHistory(
            organizationId,
            input.id,
            { threads: 10, people: 50, ...sources },
          )
        : await AgentDealRepository.dealHistory(organizationId, input.id, {
            threads: 10,
            ...sources,
          });
  if (!history) return { found: false as const, reason: "No such record." };
  const withheld = CAPTURE_KINDS.filter((kind) => !sources[kind]).map(
    (kind) => WITHHELD[kind],
  );
  return {
    found: true as const,
    ...history,
    ...(withheld.length > 0 ? { withheld } : {}),
  };
}

/**
 * finish_run: stages the run's summary and result; the run succeeds when its
 * session ends. "No action needed" is refused for a manual run whose version
 * declares an action.
 */
async function stageResult(
  organizationId: string,
  runId: string,
  input: {
    summary: string;
    result?: Record<string, unknown> | null;
    noActionNeeded?: { reason: string } | null;
  },
) {
  const { run } = await activeRun(organizationId, runId);
  if (input.noActionNeeded) {
    const refusal = RunSettlement.noActionRefusal(
      run.triggerType,
      run.manifest,
    );
    if (refusal) throw new RunRefusal(refusal);
  }
  const staged = await AgentRunRepository.stageResult(organizationId, runId, {
    summary: input.summary,
    result: input.result ?? {},
    noActionNeeded: input.noActionNeeded?.reason ?? null,
  });
  if (!staged) throw new RunRefusal("This agent run is not active.");
  return {
    staged: true,
    note: "Recorded. The run finishes when you stop: reply with the same summary and call nothing else.",
  };
}

export const RunActions = {
  runContext,
  queryCrm,
  listDeals,
  readRecord,
  stageResult,
};
