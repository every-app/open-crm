import { and, desc, eq, isNull } from "drizzle-orm";
import { sortBy } from "remeda";
import { db } from "@/db";
import { agentBuilderArtifact } from "@/db/schema";

// The files the builder writes (agent_builder_artifact): working revisions in
// a chat, and the exact snapshot each version was saved with.

export type NewArtifact = {
  id: string;
  organizationId: string;
  conversationId: string | null;
  versionId: string | null;
  path: string;
  language: string;
  content: string;
  previousContent: string | null;
  revision: number;
  status: "WRITING" | "READY";
};

const artifactColumns = () => ({
  id: agentBuilderArtifact.id,
  conversationId: agentBuilderArtifact.conversationId,
  versionId: agentBuilderArtifact.versionId,
  path: agentBuilderArtifact.path,
  language: agentBuilderArtifact.language,
  content: agentBuilderArtifact.content,
  previousContent: agentBuilderArtifact.previousContent,
  revision: agentBuilderArtifact.revision,
  status: agentBuilderArtifact.status,
  createdAt: agentBuilderArtifact.createdAt,
});

export type ArtifactRow = Awaited<ReturnType<typeof versionFiles>>[number];

/** The newest revision of each of `rows`' paths. */
function latestPerPath<Row extends { path: string; revision: number }>(
  rows: Row[],
): Row[] {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const held = latest.get(row.path);
    if (!held || row.revision > held.revision) latest.set(row.path, row);
  }
  return sortBy([...latest.values()], (row) => row.path);
}

/** A version's files, exactly as it was saved. */
async function versionFiles(organizationId: string, versionId: string) {
  const rows = await db
    .select(artifactColumns())
    .from(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, organizationId),
        eq(agentBuilderArtifact.versionId, versionId),
      ),
    );
  return latestPerPath(rows);
}

/** The newest revision of each file a builder chat wrote. */
async function conversationFiles(
  organizationId: string,
  conversationId: string,
) {
  const rows = await db
    .select(artifactColumns())
    .from(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, organizationId),
        eq(agentBuilderArtifact.conversationId, conversationId),
      ),
    );
  return latestPerPath(rows);
}

/**
 * Writes a working revision of a builder file, unless its newest revision
 * already says the same. The revision number is unique per chat and path, so
 * two writes racing for the next number can't both land.
 */
async function writeArtifact(input: {
  organizationId: string;
  conversationId: string;
  path: string;
  language: string;
  content: string;
}): Promise<{ id: string; revision: number }> {
  const [latest] = await db
    .select(artifactColumns())
    .from(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, input.organizationId),
        eq(agentBuilderArtifact.conversationId, input.conversationId),
        eq(agentBuilderArtifact.path, input.path),
      ),
    )
    .orderBy(desc(agentBuilderArtifact.revision))
    .limit(1);
  if (latest?.content === input.content) {
    return { id: latest.id, revision: latest.revision };
  }
  const row = {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    versionId: null,
    path: input.path,
    language: input.language,
    content: input.content,
    previousContent: latest?.content ?? null,
    revision: (latest?.revision ?? 0) + 1,
    status: "WRITING" as const,
  };
  await db.insert(agentBuilderArtifact).values(row);
  return { id: row.id, revision: row.revision };
}

/** A builder chat's working revisions no saved version kept. */
async function deleteUnsavedFiles(
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db
    .delete(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, organizationId),
        eq(agentBuilderArtifact.conversationId, conversationId),
        isNull(agentBuilderArtifact.versionId),
      ),
    );
}

export const AgentFileRepository = {
  versionFiles,
  conversationFiles,
  writeArtifact,
  deleteUnsavedFiles,
};
