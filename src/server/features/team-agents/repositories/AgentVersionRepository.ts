import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  agentAuditEvent,
  agentBuilderArtifact,
  agentDefinition,
  agentTrigger,
  agentVersion,
} from "@/db/schema";
import type { NewArtifact } from "./AgentFileRepository";
import { auditValues, type NewAudit } from "./AuditRepository";
import type { NewTrigger } from "./TriggerRepository";
import type { NewAgent } from "./TeamAgentRepository";

// A team agent's immutable versions (agent_version): saved by the builder
// with their triggers and files, deployed by a person, and replaced when the
// deployed one is changed from the agent's page. Each multi-row change is one
// batch.

const versionColumns = () => ({
  id: agentVersion.id,
  agentId: agentVersion.agentId,
  number: agentVersion.number,
  status: agentVersion.status,
  instructions: agentVersion.instructions,
  manifest: agentVersion.manifest,
  modelId: agentVersion.modelId,
  sourceConversationId: agentVersion.sourceConversationId,
  createdById: agentVersion.createdById,
  approvedAt: agentVersion.approvedAt,
  deployedAt: agentVersion.deployedAt,
  createdAt: agentVersion.createdAt,
});

export type VersionRow = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

async function findVersion(
  organizationId: string,
  agentId: string,
  versionId: string,
) {
  const [row] = await db
    .select(versionColumns())
    .from(agentVersion)
    .where(
      and(
        eq(agentVersion.organizationId, organizationId),
        eq(agentVersion.agentId, agentId),
        eq(agentVersion.id, versionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The agent's newest version. */
async function latestVersion(organizationId: string, agentId: string) {
  const [row] = await db
    .select(versionColumns())
    .from(agentVersion)
    .where(
      and(
        eq(agentVersion.organizationId, organizationId),
        eq(agentVersion.agentId, agentId),
      ),
    )
    .orderBy(desc(agentVersion.number))
    .limit(1);
  return row ?? null;
}

export type NewVersion = {
  id: string;
  organizationId: string;
  agentId: string;
  number: number;
  status: "READY" | "DEPLOYED";
  instructions: string;
  manifest: unknown;
  modelId: string;
  sourceConversationId: string | null;
  createdById: string;
  approvedAt?: string | null;
  deployedAt?: string | null;
};

/**
 * Writes a new version with its triggers, file snapshots and audit lines in
 * one batch, so a version never exists without the triggers it declares.
 * `agent` creates the agent first (the chat's first save).
 */
async function saveVersion(input: {
  agent?: NewAgent;
  renameDraft?: { name: string; description: string };
  version: NewVersion;
  triggers: NewTrigger[];
  artifacts: NewArtifact[];
  /** WRITING revisions this save snapshots in place (now READY). */
  claimedArtifactIds: string[];
  audit: NewAudit[];
}): Promise<void> {
  const { version } = input;
  await runBatch((tx) => [
    ...(input.agent ? [tx.insert(agentDefinition).values(input.agent)] : []),
    ...(input.renameDraft
      ? [
          tx
            .update(agentDefinition)
            .set({
              ...input.renameDraft,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(agentDefinition.organizationId, version.organizationId),
                eq(agentDefinition.id, version.agentId),
                eq(agentDefinition.status, "DRAFT"),
              ),
            ),
        ]
      : []),
    tx.insert(agentVersion).values(version),
    ...(input.triggers.length > 0
      ? [tx.insert(agentTrigger).values(input.triggers)]
      : []),
    ...(input.artifacts.length > 0
      ? [tx.insert(agentBuilderArtifact).values(input.artifacts)]
      : []),
    ...(input.claimedArtifactIds.length > 0
      ? [
          tx
            .update(agentBuilderArtifact)
            .set({ versionId: version.id, status: "READY" })
            .where(
              and(
                eq(agentBuilderArtifact.organizationId, version.organizationId),
                inArray(agentBuilderArtifact.id, input.claimedArtifactIds),
              ),
            ),
        ]
      : []),
    ...input.audit.map((event) =>
      tx.insert(agentAuditEvent).values(auditValues(event)),
    ),
  ]);
}

/**
 * Makes `versionId` the team's: it alone DEPLOYED, the agent LIVE on it, its
 * triggers the only enabled ones, and the audit line, in one batch. A replay
 * of the same request trips the audit line's unique key and changes nothing.
 */
async function deploy(input: {
  organizationId: string;
  agentId: string;
  versionId: string;
  name: string;
  description: string | null;
  audit: NewAudit;
}): Promise<void> {
  const { organizationId, agentId, versionId } = input;
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(agentVersion)
      .set({ status: "READY" })
      .where(
        and(
          eq(agentVersion.organizationId, organizationId),
          eq(agentVersion.agentId, agentId),
          eq(agentVersion.status, "DEPLOYED"),
          ne(agentVersion.id, versionId),
        ),
      ),
    tx
      .update(agentVersion)
      .set({ status: "DEPLOYED", approvedAt: now, deployedAt: now })
      .where(
        and(
          eq(agentVersion.organizationId, organizationId),
          eq(agentVersion.id, versionId),
        ),
      ),
    tx
      .update(agentDefinition)
      .set({
        currentVersionId: versionId,
        status: "LIVE",
        archivedAt: null,
        name: input.name,
        description: input.description,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentDefinition.organizationId, organizationId),
          eq(agentDefinition.id, agentId),
        ),
      ),
    tx
      .update(agentTrigger)
      .set({ enabled: sql`${agentTrigger.versionId} = ${versionId}` })
      .where(
        and(
          eq(agentTrigger.organizationId, organizationId),
          eq(agentTrigger.agentId, agentId),
        ),
      ),
    tx.insert(agentAuditEvent).values(auditValues(input.audit)),
  ]);
}

/**
 * Puts the agent on a new version derived from its current one (a revision
 * from the detail page), moving its triggers over, in one batch.
 */
async function replaceCurrentVersion(input: {
  version: NewVersion;
  fromVersionId: string;
  artifacts: NewArtifact[];
  audit: NewAudit;
}): Promise<void> {
  const { version } = input;
  await runBatch((tx) => [
    tx.insert(agentVersion).values(version),
    ...(input.artifacts.length > 0
      ? [tx.insert(agentBuilderArtifact).values(input.artifacts)]
      : []),
    tx
      .update(agentVersion)
      .set({ status: "READY" })
      .where(
        and(
          eq(agentVersion.organizationId, version.organizationId),
          eq(agentVersion.id, input.fromVersionId),
        ),
      ),
    tx
      .update(agentDefinition)
      .set({
        currentVersionId: version.id,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(agentDefinition.organizationId, version.organizationId),
          eq(agentDefinition.id, version.agentId),
        ),
      ),
    tx
      .update(agentTrigger)
      .set({ versionId: version.id })
      .where(
        and(
          eq(agentTrigger.organizationId, version.organizationId),
          eq(agentTrigger.agentId, version.agentId),
          eq(agentTrigger.versionId, input.fromVersionId),
        ),
      ),
    tx.insert(agentAuditEvent).values(auditValues(input.audit)),
  ]);
}

export const AgentVersionRepository = {
  findVersion,
  latestVersion,
  saveVersion,
  deploy,
  replaceCurrentVersion,
};
