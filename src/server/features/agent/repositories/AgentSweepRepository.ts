import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { db } from "@/db";
import {
  agentTask,
  company,
  contact,
  workspace,
  workspaceProfile,
} from "@/db/schema";

// What the enrichment sweep (dispatch/sweep.ts) finds in one organization's
// records, ported from the CRM's BackfillService. Every read but `claimDue`
// is scoped to one organization; `claimDue` picks whose turn it is across
// them, and hands back only organization ids. Archived records are left
// alone: nobody is looking at them.

/**
 * A task of `kind` about the outer query's record that is open, or (with
 * `endedSince`) open or finished at or after it.
 */
function taskAbout(
  organizationId: string,
  kind: string,
  record: { column: "companyId" | "contactId"; id: AnyColumn },
  endedSince?: string,
) {
  return db
    .select({ id: agentTask.id })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.kind, kind),
        eq(agentTask[record.column], record.id),
        endedSince === undefined
          ? isNull(agentTask.finishedAt)
          : or(
              isNull(agentTask.finishedAt),
              gte(agentTask.finishedAt, endedSince),
            ),
      ),
    );
}

const companyRecord = { column: "companyId", id: company.id } as const;
const contactRecord = { column: "contactId", id: contact.id } as const;

/**
 * Takes up to `limit` organizations whose last sweep is older than
 * `everyMs` (or that were never swept), longest waiting first, and marks
 * them swept now. A conditional update, so two overlapping ticks never sweep
 * the same organization.
 */
async function claimDue(limit: number, everyMs: number): Promise<string[]> {
  const now = new Date();
  const due = or(
    isNull(workspace.enrichmentSweptAt),
    lt(
      workspace.enrichmentSweptAt,
      new Date(now.getTime() - everyMs).toISOString(),
    ),
  );
  const candidates = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(due)
    .orderBy(sql`coalesce(${workspace.enrichmentSweptAt}, '')`)
    .limit(limit);
  if (candidates.length === 0) return [];
  // Not `updated_at`: nobody edited the workspace.
  const claimed = await db
    .update(workspace)
    .set({ enrichmentSweptAt: now.toISOString() })
    .where(
      and(
        inArray(
          workspace.organizationId,
          candidates.map((row) => row.organizationId),
        ),
        due,
      ),
    )
    .returning({ organizationId: workspace.organizationId });
  return claimed.map((row) => row.organizationId);
}

/**
 * The workspace's website when it has no profile of its own business yet and
 * no attempt at one is open or ended since `endedSince`.
 */
async function websiteWithoutProfile(
  organizationId: string,
  endedSince: string,
): Promise<string | null> {
  const [row] = await db
    .select({ website: workspace.website })
    .from(workspace)
    .leftJoin(
      workspaceProfile,
      eq(workspaceProfile.organizationId, workspace.organizationId),
    )
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        isNotNull(workspace.website),
        isNull(workspaceProfile.organizationId),
        notExists(
          db
            .select({ id: agentTask.id })
            .from(agentTask)
            .where(
              and(
                eq(agentTask.organizationId, organizationId),
                eq(agentTask.kind, "workspace-profile"),
                or(
                  isNull(agentTask.finishedAt),
                  gte(agentTask.finishedAt, endedSince),
                ),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return row?.website ?? null;
}

/**
 * Companies with a domain that were never successfully looked up: still
 * PENDING (a brand lookup with no Context.dev key leaves them so), or FAILED
 * with no brand lookup since `failedSince`. None with a lookup open.
 */
async function companiesNeverLookedUp(
  organizationId: string,
  failedSince: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        isNull(company.archivedAt),
        isNotNull(company.domain),
        or(
          eq(company.enrichmentStatus, "PENDING"),
          and(
            eq(company.enrichmentStatus, "FAILED"),
            notExists(
              taskAbout(organizationId, "brand", companyRecord, failedSince),
            ),
          ),
        ),
        notExists(taskAbout(organizationId, "brand", companyRecord)),
      ),
    )
    .orderBy(asc(company.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Companies with a domain and neither a logo nor an icon, whose brand was
 * not looked up since `endedSince`.
 */
async function companiesWithoutArtwork(
  organizationId: string,
  endedSince: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        isNull(company.archivedAt),
        isNotNull(company.domain),
        isNull(company.logoUrl),
        isNull(company.iconUrl),
        notExists(
          taskAbout(organizationId, "brand", companyRecord, endedSince),
        ),
      ),
    )
    .orderBy(asc(company.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Contacts with no photo and somewhere to look for one, not looked for since
 * `endedSince`. The places are the photo lookup's: a GitHub profile, and
 * where Context.dev can read them (`contextReady`), a LinkedIn profile or the
 * employer's website.
 */
async function contactsNeedingPhoto(
  organizationId: string,
  input: { contextReady: boolean; endedSince: string; limit: number },
): Promise<string[]> {
  const rows = await db
    .select({ id: contact.id })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.id, contact.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contact.organizationId, organizationId),
        isNull(contact.archivedAt),
        isNull(contact.imageUrl),
        input.contextReady
          ? or(
              isNotNull(contact.githubUrl),
              isNotNull(contact.linkedinUrl),
              isNotNull(company.domain),
            )
          : isNotNull(contact.githubUrl),
        notExists(
          taskAbout(
            organizationId,
            "portrait",
            contactRecord,
            input.endedSince,
          ),
        ),
      ),
    )
    .orderBy(asc(contact.createdAt))
    .limit(input.limit);
  return rows.map((row) => row.id);
}

/**
 * Contacts never successfully researched (PENDING or FAILED) with no attempt
 * open or ended since `endedSince`.
 */
async function contactsNeverResearched(
  organizationId: string,
  endedSince: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        isNull(contact.archivedAt),
        inArray(contact.enrichmentStatus, ["PENDING", "FAILED"]),
        notExists(
          taskAbout(organizationId, "identify", contactRecord, endedSince),
        ),
      ),
    )
    .orderBy(asc(contact.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export const AgentSweepRepository = {
  claimDue,
  websiteWithoutProfile,
  companiesNeverLookedUp,
  companiesWithoutArtwork,
  contactsNeedingPhoto,
  contactsNeverResearched,
};
