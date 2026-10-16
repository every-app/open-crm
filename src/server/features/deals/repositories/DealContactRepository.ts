import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, dealContact } from "@/db/schema";

// The people on a deal (deal_contact), each with an optional role, and the
// contacts a deal may take on. The contacts feature owns contacts; a deal
// only links the ones at its company. Archived contacts stay out of sight,
// as they do everywhere, and come back with their links when restored.

const contactColumns = {
  id: contact.id,
  firstName: contact.firstName,
  lastName: contact.lastName,
  email: contact.email,
  title: contact.title,
  imageUrl: contact.imageUrl,
};

const byName = [
  sql`lower(${contact.firstName})`,
  sql`(${contact.lastName} is null)`,
  sql`lower(${contact.lastName})`,
  asc(contact.id),
];

function link(organizationId: string, dealId: string, contactId: string) {
  return and(
    eq(dealContact.organizationId, organizationId),
    eq(dealContact.dealId, dealId),
    eq(dealContact.contactId, contactId),
  );
}

/** The deal's live contacts with their roles, by first name. */
async function listForDeal(organizationId: string, dealId: string) {
  return db
    .select({ ...contactColumns, role: dealContact.role })
    .from(dealContact)
    .innerJoin(
      contact,
      and(
        eq(contact.id, dealContact.contactId),
        eq(contact.organizationId, dealContact.organizationId),
      ),
    )
    .where(
      and(
        eq(dealContact.organizationId, organizationId),
        eq(dealContact.dealId, dealId),
        isNull(contact.archivedAt),
      ),
    )
    .orderBy(...byName);
}

/** Live contacts at `companyId` who aren't on the deal yet, for its picker. */
async function options(
  organizationId: string,
  dealId: string,
  companyId: string,
) {
  return db
    .select(contactColumns)
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.companyId, companyId),
        isNull(contact.archivedAt),
        notExists(
          db
            .select({ id: dealContact.contactId })
            .from(dealContact)
            .where(
              and(
                eq(dealContact.organizationId, organizationId),
                eq(dealContact.dealId, dealId),
                eq(dealContact.contactId, contact.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(...byName)
    .limit(100);
}

/** A live contact of the organization, with the company they work at. */
async function findContact(organizationId: string, contactId: string) {
  const [row] = await db
    .select({
      id: contact.id,
      companyId: contact.companyId,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
        isNull(contact.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Puts the contact on the deal. Someone already on it keeps their role
 * unless `role` gives a new one.
 */
async function attach(
  organizationId: string,
  input: { dealId: string; contactId: string; role: string | null },
) {
  const insert = db.insert(dealContact).values({ organizationId, ...input });
  const target = [dealContact.dealId, dealContact.contactId];
  if (input.role === null) {
    await insert.onConflictDoNothing({ target });
    return;
  }
  await insert.onConflictDoUpdate({
    target,
    set: { role: input.role },
    setWhere: eq(dealContact.organizationId, organizationId),
  });
}

/** Takes the contact off the deal; false when they weren't on it. */
async function detach(
  organizationId: string,
  dealId: string,
  contactId: string,
): Promise<boolean> {
  const rows = await db
    .delete(dealContact)
    .where(link(organizationId, dealId, contactId))
    .returning({ contactId: dealContact.contactId });
  return rows.length > 0;
}

/** Sets (or, with null, clears) the contact's role; false when they aren't on the deal. */
async function setRole(
  organizationId: string,
  input: { dealId: string; contactId: string; role: string | null },
): Promise<boolean> {
  const rows = await db
    .update(dealContact)
    .set({ role: input.role })
    .where(link(organizationId, input.dealId, input.contactId))
    .returning({ contactId: dealContact.contactId });
  return rows.length > 0;
}

export const DealContactRepository = {
  listForDeal,
  options,
  findContact,
  attach,
  detach,
  setRole,
};
