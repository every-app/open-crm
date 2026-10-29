import { env } from "cloudflare:workers";
import { ErasureRepository } from "@/server/features/erasure/repositories/ErasureRepository";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";

// Erasing one organization for good, for the operator's script
// (scripts/erase-organization.ts, docs/maintainers/runbooks/erase-organization.md).
// A Worker invocation has limits, so `eraseNext` does as much as fits a time
// budget and says whether it is done; the script calls it until it is. Each
// call, in order:
//
// 1. stops what would write more of the organization (ErasureRepository.freeze);
// 2. withdraws its grants: every member's mailbox, as Disconnect does
//    (Google's grant only where no other workspace uses the account);
// 3. deletes its R2 objects (logos and photos, builder attachments);
// 4. deletes its rows, the largest tables in batches, then the organization,
//    which cascades to the rest, with its members' users.
//
// Every step is idempotent, so a call that fails is simply made again.

const BUDGET_MS = 20_000;
const ROWS_PER_PASS = 2_000;

type Erased = {
  mailboxes: number;
  objects: number;
  users: number;
};

function bucket(): R2Bucket | null {
  return Reflect.get(env, "R2") ?? null;
}

/** The R2 prefixes the organization's objects live under. */
const prefixes = (organizationId: string) => [
  `${organizationId}/`,
  `builder-attachments/${organizationId}/`,
];

async function objectCount(organizationId: string): Promise<number> {
  const r2 = bucket();
  if (!r2) return 0;
  let total = 0;
  for (const prefix of prefixes(organizationId)) {
    let cursor: string | undefined;
    do {
      const page = await r2.list({ prefix, cursor });
      total += page.objects.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return total;
}

/** What erasing the organization would remove: the dry run. */
async function inventory(organizationId: string) {
  const [exists, rows, members, mailboxes, objects] = await Promise.all([
    ErasureRepository.organizationExists(organizationId),
    ErasureRepository.rowCounts(organizationId),
    ErasureRepository.members(organizationId),
    ConnectionRepository.listForOrganization(organizationId),
    objectCount(organizationId),
  ]);
  return {
    organizationId,
    exists,
    members: members.map((one) => ({
      userId: one.userId,
      email: one.email,
      role: one.role,
      lastSeenAt: one.lastSeenAt,
    })),
    rows,
    mailboxes: mailboxes.map((one) => ({
      userId: one.userId,
      provider: one.provider,
      accountEmail: one.accountEmail,
    })),
    objects,
  };
}

/** The next bounded step of erasing the organization. */
async function eraseNext(
  organizationId: string,
): Promise<{ done: boolean; erased: Erased }> {
  const deadline = Date.now() + BUDGET_MS;
  const erased: Erased = {
    mailboxes: 0,
    objects: 0,
    users: 0,
  };
  const late = () => Date.now() >= deadline;

  await ErasureRepository.freeze(organizationId);

  for (const one of await ConnectionRepository.listForOrganization(
    organizationId,
  )) {
    if (late()) return { done: false, erased };
    await ConnectionService.disconnect(
      { organizationId, userId: one.userId },
      one.provider,
    );
    erased.mailboxes += 1;
  }

  const r2 = bucket();
  for (const prefix of r2 ? prefixes(organizationId) : []) {
    for (;;) {
      if (late() || !r2) return { done: false, erased };
      const page = await r2.list({ prefix });
      if (page.objects.length === 0) break;
      await r2.delete(page.objects.map((object) => object.key));
      erased.objects += page.objects.length;
    }
  }

  while (
    await ErasureRepository.deleteHeavyBatch(organizationId, ROWS_PER_PASS)
  ) {
    if (late()) return { done: false, erased };
  }
  erased.users = await ErasureRepository.deleteOrganization(organizationId);
  console.log("[erasure] organization erased", { organizationId });
  return { done: true, erased };
}

export const OrganizationErasureService = { inventory, eraseNext };
