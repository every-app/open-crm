import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { SyncStateRepository } from "@/server/features/mailbox/repositories/SyncStateRepository";
import { toHex } from "./org-slug";

// Each Every App organization is a CRM organization with the same id, so its
// records and everything under them are scoped by it, as OpenSEO scopes
// hosted organizations. The slug hex-encodes the id: gateway ids are
// mixed-case, and slugify alone would fold two of them into one slug.
function getEveryAppOrganizationSlug(organizationId: string) {
  return `everyapp-${toHex(organizationId)}`;
}

function getEveryAppOrganizationName(organizationId: string) {
  return `Organization ${organizationId.slice(0, 8)}`;
}

// What this isolate has already written, so a request makes no writes once
// its user, organization and role are known that day: membership → role and
// day. Values, not promises: Workers can't share a pending database call
// across requests. A role change at the gateway writes again, so the member
// row follows it, and so does a new day, so the row says when the member was
// last seen.
const ensuredMemberships = new Map<string, string>();
const MAX_ENSURED_MEMBERSHIPS = 5_000;

export async function ensureEveryAppMembership(input: {
  organizationId: string;
  userId: string;
  role: string;
}) {
  const key = JSON.stringify([input.organizationId, input.userId]);
  const seenAt = new Date().toISOString();
  const ensured = `${input.role} ${seenAt.slice(0, 10)}`;
  if (ensuredMemberships.get(key) === ensured) return input.organizationId;

  await AuthRepository.ensureOrganization({
    id: input.organizationId,
    name: getEveryAppOrganizationName(input.organizationId),
    slug: getEveryAppOrganizationSlug(input.organizationId),
  });
  // The day's first sighting: mailbox syncs paused while the member was away
  // (MemberMailboxService.pauseUnseen) carry on.
  if (await AuthRepository.upsertMember({ ...input, seenAt })) {
    await SyncStateRepository.resume(input.organizationId, input.userId);
  }

  if (ensuredMemberships.size >= MAX_ENSURED_MEMBERSHIPS) {
    ensuredMemberships.clear();
  }
  ensuredMemberships.set(key, ensured);
  return input.organizationId;
}
