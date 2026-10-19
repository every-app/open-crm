import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { SyncStateRepository } from "@/server/features/mailbox/repositories/SyncStateRepository";
import { connectionView } from "@/server/features/mailbox/services/ConnectionService";

// Other members' mailboxes. The gateway never tells the CRM whom it removed,
// so a member who left keeps syncing into the organization: owners and
// admins can see every member's connection, delete what one synced and
// disconnect it (memberFor, with ConnectionService), and a member the CRM
// hasn't seen for 30 days has their syncs paused until it sees them again.

type Member = { organizationId: string; userId: string };
type Caller = Member & { role: string };

const UNSEEN_PAUSE_MS = 30 * 86_400_000;

/**
 * The member whose connection a caller manages: their own, or, for an owner
 * or admin, any member's in the organization (one who left, say).
 */
function memberFor(caller: Caller, userId: string | undefined): Member {
  if (userId !== undefined && userId !== caller.userId) {
    requireOrgPermission(caller, { connection: ["manage"] });
  }
  return {
    organizationId: caller.organizationId,
    userId: userId ?? caller.userId,
  };
}

/** Settings → Connections for owners and admins: every member's connections. */
async function list(caller: Caller) {
  requireOrgPermission(caller, { connection: ["manage"] });
  const [connections, rows] = await Promise.all([
    ConnectionRepository.listForOrganization(caller.organizationId),
    SyncStateRepository.listForOrganization(caller.organizationId),
  ]);
  const now = new Date().toISOString();
  return connections.map((connection) => ({
    userId: connection.userId,
    name: connection.name,
    provider: connection.provider,
    connection: connectionView(
      connection,
      rows.filter((row) => row.userId === connection.userId),
      now,
    ),
  }));
}

export type MemberMailboxes = Awaited<ReturnType<typeof list>>;

/**
 * The daily cron: pauses the syncs of members the CRM hasn't seen for 30
 * days, across every organization; seeing them again resumes them
 * (ensureEveryAppMembership). A member it has no sighting of yet starts their
 * 30 days now.
 */
async function pauseUnseen(now = new Date()) {
  await AuthRepository.startUnseenClocks(now.toISOString());
  const paused = await SyncStateRepository.pauseUnseen(
    new Date(now.getTime() - UNSEEN_PAUSE_MS).toISOString(),
  );
  if (paused > 0) {
    console.log("[mailbox] syncs paused: members not seen in 30 days", {
      paused,
    });
  }
  return { paused };
}

export const MemberMailboxService = { memberFor, list, pauseUnseen };
