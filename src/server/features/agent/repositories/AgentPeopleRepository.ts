import { and, eq, exists, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { activity, company, contact } from "@/db/schema";

// The contact reads and writes behind the agent's people research, ported
// from the CRM's lib/crm.ts: who a candidate profile has to be, the LinkedIn
// URL on file, when socials were last looked for, and a job change raised on
// the timeline. Scoped to the organization; a company id from the model is
// checked to be the organization's before a contact is moved to it.

/** Who the contact is, as a candidate profile is checked against. */
async function subject(organizationId: string, contactId: string) {
  const [row] = await db
    .select({
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
      ownerId: contact.ownerId,
      companyId: company.id,
      companyName: company.name,
      companyDomain: company.domain,
    })
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
        eq(contact.id, contactId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Notes that the contact's socials were looked for. */
async function stampSocialsChecked(
  organizationId: string,
  contactId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(contact)
    .set({ socialsCheckedAt: now, updatedAt: now })
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
      ),
    );
}

/** Whether `companyId` is a live company of the organization. */
async function companyExists(
  organizationId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
        isNull(company.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Raises a job change: a note on the contact's timeline, written by the
 * agent, and, when `moveToCompanyId` is given, the contact moved to that
 * company of the organization. One batch. False when the contact isn't the
 * organization's.
 */
async function raiseJobChange(
  organizationId: string,
  input: {
    contactId: string;
    companyId: string | null;
    subject: string;
    body: string;
    meta: unknown;
    moveToCompanyId: string | null;
  },
): Promise<boolean> {
  const ofContact = and(
    eq(contact.organizationId, organizationId),
    eq(contact.id, input.contactId),
  );
  const [owned] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(ofContact)
    .limit(1);
  if (!owned) return false;
  const now = new Date().toISOString();
  const moveTo = input.moveToCompanyId;
  await runBatch((tx) => [
    tx.insert(activity).values({
      id: crypto.randomUUID(),
      organizationId,
      type: "NOTE",
      subject: input.subject,
      body: input.body,
      occurredAt: now,
      contactId: input.contactId,
      companyId: input.companyId,
      // Null: the research agent wrote it.
      createdById: null,
      meta: input.meta,
    }),
    tx.update(contact).set({ lastActivityAt: now }).where(ofContact),
    ...(input.companyId
      ? [
          tx
            .update(company)
            .set({ lastActivityAt: now })
            .where(
              and(
                eq(company.organizationId, organizationId),
                eq(company.id, input.companyId),
              ),
            ),
        ]
      : []),
    ...(moveTo
      ? [
          tx
            .update(contact)
            .set({ companyId: moveTo, updatedAt: now })
            .where(
              and(
                ofContact,
                exists(
                  tx
                    .select({ id: company.id })
                    .from(company)
                    .where(
                      and(
                        eq(company.organizationId, organizationId),
                        eq(company.id, moveTo),
                        isNull(company.archivedAt),
                      ),
                    ),
                ),
              ),
            ),
        ]
      : []),
  ]);
  return true;
}

export const AgentPeopleRepository = {
  subject,
  stampSocialsChecked,
  companyExists,
  raiseJobChange,
};
