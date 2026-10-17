import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
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
// its user, organization and role are known: membership → role. Values, not
// promises: Workers can't share a pending database call across requests. A
// role change at the gateway writes again, so the member row follows it.
const ensuredMemberships = new Map<string, string>();
const MAX_ENSURED_MEMBERSHIPS = 5_000;

export async function ensureEveryAppMembership(input: {
  organizationId: string;
  userId: string;
  role: string;
}) {
  const key = JSON.stringify([input.organizationId, input.userId]);
  if (ensuredMemberships.get(key) === input.role) return input.organizationId;

  await AuthRepository.ensureOrganization({
    id: input.organizationId,
    name: getEveryAppOrganizationName(input.organizationId),
    slug: getEveryAppOrganizationSlug(input.organizationId),
  });
  await AuthRepository.upsertMember(input);

  if (ensuredMemberships.size >= MAX_ENSURED_MEMBERSHIPS) {
    ensuredMemberships.clear();
  }
  ensuredMemberships.set(key, input.role);
  return input.organizationId;
}
