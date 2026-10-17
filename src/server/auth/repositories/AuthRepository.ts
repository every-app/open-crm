import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member, organization, user } from "@/db/schema";

type OrganizationInput = {
  id: string;
  name: string;
  slug: string;
};

// The gateway's organization, created the first time one of its members opens
// the CRM. The name is a placeholder set once: the gateway owns the real one,
// and the CRM shows its workspace's own name (the `workspace` row) instead.
async function ensureOrganization(input: OrganizationInput) {
  await db
    .insert(organization)
    .values({
      id: input.id,
      name: input.name,
      slug: input.slug,
      logo: null,
      createdAt: new Date(),
      metadata: null,
    })
    .onConflictDoNothing({ target: organization.id });
}

// The member row mirrors the gateway's membership for features that list who
// belongs to an organization (owner pickers, "is this a colleague"). It is
// never the authorization fact: the signed identity on each request is
// (ensure-user/everyApp.ts).
async function upsertMember(input: {
  organizationId: string;
  userId: string;
  role: string;
}) {
  await db
    .insert(member)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [member.organizationId, member.userId],
      set: { role: input.role },
    });
}

/**
 * The people the gateway has let into the organization's CRM so far, oldest
 * first, with when each joined (first opened the CRM).
 */
async function listMembers(organizationId: string) {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt));
  return rows.map((row) => ({
    ...row,
    joinedAt: row.joinedAt.toISOString(),
  }));
}

/** Whether `userId` is a mirrored member of `organizationId`. */
async function isMember(organizationId: string, userId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
    .limit(1);
  return Boolean(row);
}

/** Names and emails for user ids (owners, authors), in no particular order. */
async function getUsers(userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(inArray(user.id, userIds));
}

export const AuthRepository = {
  ensureOrganization,
  upsertMember,
  listMembers,
  isMember,
  getUsers,
};
