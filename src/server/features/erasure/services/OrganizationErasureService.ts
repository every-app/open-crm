import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { CrmAgent } from "@/server/features/agent/CrmAgent";
import { parseSessionName } from "@/server/features/agent/sessionName";
import { ErasureRepository } from "@/server/features/erasure/repositories/ErasureRepository";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { slackCall } from "@/server/features/slack/lib/slackApi";
import { SlackRepository } from "@/server/features/slack/repositories/SlackRepository";

// Erasing one organization for good, for the operator's script
// (scripts/erase-organization.ts, docs/maintainers/runbooks/erase-organization.md).
// A Worker invocation has limits, so `eraseNext` does as much as fits a time
// budget and says whether it is done; the script calls it until it is. Each
// call, in order:
//
// 1. stops what would write more of the organization (ErasureRepository.freeze);
// 2. withdraws its grants: every member's mailbox, as Disconnect does
//    (Google's grant only where no other workspace uses the account), and
//    Slack's tokens (auth.revoke);
// 3. destroys its agents' Durable Objects (chats, research, runs), then
//    forgets the rows that named them;
// 4. deletes its R2 objects (logos and photos, builder attachments);
// 5. deletes its rows, the largest tables in batches, then the organization,
//    which cascades to the rest, with the users no other organization has.
//
// Every step is idempotent, so a call that fails is simply made again.

const BUDGET_MS = 20_000;
const SESSIONS_PER_PASS = 50;
const ROWS_PER_PASS = 2_000;

/** Slack's answers for a token that no longer works: nothing to revoke. */
const SLACK_GONE = new Set([
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "not_authed",
]);

type Erased = {
  mailboxes: number;
  slackTokens: number;
  sessions: number;
  objects: number;
  users: number;
  usersKept: number;
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
  const [exists, rows, members, mailboxes, slack, sessions, objects] =
    await Promise.all([
      ErasureRepository.organizationExists(organizationId),
      ErasureRepository.rowCounts(organizationId),
      ErasureRepository.members(organizationId),
      ConnectionRepository.listForOrganization(organizationId),
      SlackRepository.getConnection(organizationId),
      ErasureRepository.sessionNames(organizationId, 10_000),
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
      erasedWithIt: one.memberships === 1,
    })),
    rows,
    mailboxes: mailboxes.map((one) => ({
      userId: one.userId,
      provider: one.provider,
      accountEmail: one.accountEmail,
    })),
    slack: slack ? { teamName: slack.teamName } : null,
    sessions: sessions.length,
    objects,
    // Billing isn't the CRM's to erase: the operator deletes it by hand.
    autumnCustomerId: organizationId,
  };
}

async function revokeSlack(organizationId: string): Promise<number> {
  const tokens = await SlackRepository.getTokens(organizationId);
  if (!tokens) return 0;
  let revoked = 0;
  for (const token of [tokens.botToken, tokens.userToken]) {
    if (!token) continue;
    const reply = await slackCall(token, "auth.revoke");
    if (!reply.ok && !SLACK_GONE.has(reply.error ?? "")) {
      throw new Error(`Slack did not revoke a token: ${reply.error}`);
    }
    revoked += 1;
  }
  await SlackRepository.deleteConnection(organizationId);
  return revoked;
}

function agents(): DurableObjectNamespace<CrmAgent> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  return env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
}

/** Empties a session's Durable Object: its messages, state and alarms. */
async function destroySession(name: string) {
  const agent = await getAgentByName(agents(), name);
  try {
    await agent.destroy();
  } catch (error) {
    // destroy() ends the object once its storage is gone, which can reach
    // the caller as this error.
    if (!String(error).includes("destroyed")) throw error;
  }
}

/** The next bounded step of erasing the organization. */
async function eraseNext(
  organizationId: string,
): Promise<{ done: boolean; erased: Erased }> {
  const deadline = Date.now() + BUDGET_MS;
  const erased: Erased = {
    mailboxes: 0,
    slackTokens: 0,
    sessions: 0,
    objects: 0,
    users: 0,
    usersKept: 0,
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
  erased.slackTokens = await revokeSlack(organizationId);

  for (;;) {
    if (late()) return { done: false, erased };
    const names = await ErasureRepository.sessionNames(
      organizationId,
      SESSIONS_PER_PASS,
    );
    if (names.length === 0) break;
    for (const name of names) {
      // Never another organization's object, whatever a row says.
      if (parseSessionName(name)?.organizationId !== organizationId) continue;
      await destroySession(name);
      erased.sessions += 1;
    }
    await ErasureRepository.forgetSessions(organizationId, names);
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
  const users = await ErasureRepository.deleteOrganization(organizationId);
  erased.users = users.erased;
  erased.usersKept = users.kept;
  console.log("[erasure] organization erased", { organizationId });
  return { done: true, erased };
}

export const OrganizationErasureService = { inventory, eraseNext };
