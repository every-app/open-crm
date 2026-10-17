import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  company,
  contact,
  contactBrief,
  workspace,
  workspaceProfile,
} from "@/db/schema";
import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";

// What the agent writes down: the profile of the organization's own business,
// a contact's background brief, and research briefs on a company's timeline.
// Scoped to the organization like every other repository.

const sectionsSchema = z
  .object({
    sells: z.string().optional().catch(undefined),
    sellsTo: z.string().optional().catch(undefined),
    edge: z.string().optional().catch(undefined),
  })
  .catch({});

export type ProfileSections = z.infer<typeof sectionsSchema>;

export type WorkspaceIdentity = {
  name: string;
  website: string | null;
  profile: {
    narrative: string;
    sections: ProfileSections;
    refreshedAt: string;
  } | null;
};

/**
 * Who the organization is, as the agent introduces it to every session. The
 * profile dies with its website: one written for another site is not shown.
 */
async function workspaceIdentity(
  organizationId: string,
): Promise<WorkspaceIdentity | null> {
  const [row] = await db
    .select({
      name: workspace.name,
      website: workspace.website,
      profileWebsite: workspaceProfile.website,
      narrative: workspaceProfile.narrative,
      sections: workspaceProfile.sections,
      refreshedAt: workspaceProfile.refreshedAt,
    })
    .from(workspace)
    .leftJoin(
      workspaceProfile,
      eq(workspaceProfile.organizationId, workspace.organizationId),
    )
    .where(eq(workspace.organizationId, organizationId))
    .limit(1);
  if (!row) return null;
  const current =
    row.website && row.profileWebsite === row.website && row.narrative;
  return {
    name: row.name,
    website: row.website,
    profile:
      current && row.narrative && row.refreshedAt
        ? {
            narrative: row.narrative,
            sections: sectionsSchema.parse(row.sections),
            refreshedAt: row.refreshedAt,
          }
        : null,
  };
}

async function writeWorkspaceProfile(
  organizationId: string,
  input: {
    website: string;
    narrative: string;
    sections: ProfileSections;
    sourceUrl: string | null;
    sessionId: string;
  },
): Promise<void> {
  const fields = {
    website: input.website,
    narrative: input.narrative,
    sections: input.sections,
    sourceUrl: input.sourceUrl,
    sessionId: input.sessionId,
    refreshedAt: new Date().toISOString(),
  };
  await db
    .insert(workspaceProfile)
    .values({ organizationId, ...fields })
    .onConflictDoUpdate({
      target: workspaceProfile.organizationId,
      set: fields,
    });
}

/** Writes the contact's brief. False when the contact isn't the organization's. */
async function writeContactBrief(
  organizationId: string,
  input: {
    contactId: string;
    narrative: string;
    sections: unknown;
    score: number;
    sourceUrl: string | null;
    sessionId: string;
  },
): Promise<boolean> {
  const [owned] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, input.contactId),
      ),
    )
    .limit(1);
  if (!owned) return false;
  const fields = {
    narrative: input.narrative,
    sections: input.sections,
    score: input.score,
    sourceUrl: input.sourceUrl,
    sessionId: input.sessionId,
    refreshedAt: new Date().toISOString(),
  };
  await db
    .insert(contactBrief)
    .values({ contactId: input.contactId, organizationId, ...fields })
    .onConflictDoUpdate({
      target: contactBrief.contactId,
      set: fields,
      setWhere: eq(contactBrief.organizationId, organizationId),
    });
  return true;
}

/**
 * A research brief on the company's timeline, written by the agent. Its
 * activity id, or null when the company isn't the organization's.
 */
async function addCompanyBrief(
  organizationId: string,
  input: {
    companyId: string;
    subject: string;
    body: string;
    meta: Record<string, unknown>;
  },
): Promise<string | null> {
  const [owned] = await db
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, input.companyId),
      ),
    )
    .limit(1);
  if (!owned) return null;
  return ActivityRepository.insert({
    organizationId,
    type: "ENRICHMENT",
    subject: input.subject,
    body: input.body,
    occurredAt: new Date().toISOString(),
    dueAt: null,
    companyId: input.companyId,
    contactId: null,
    dealId: null,
    // Null: the research agent wrote it.
    createdById: null,
    meta: input.meta,
  });
}

export const AgentProfileRepository = {
  workspaceIdentity,
  writeWorkspaceProfile,
  writeContactBrief,
  addCompanyBrief,
};
