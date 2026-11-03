import { ArchiveRepository } from "@/server/features/archive/repositories/ArchiveRepository";
import {
  connectLink,
  mailboxFetch,
  providerStatus,
} from "@/server/features/mailbox/providers/gateway";
import { probeMailbox } from "@/server/features/mailbox/providers/probeMailbox";
import { CaptureWriteRepository } from "@/server/features/mailbox/repositories/CaptureWriteRepository";
import { SyncedDataRepository } from "@/server/features/mailbox/repositories/SyncedDataRepository";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import {
  SyncStateRepository,
  type SyncRow,
} from "@/server/features/mailbox/repositories/SyncStateRepository";
import { MailboxSyncService } from "@/server/features/mailbox/services/MailboxSyncService";
import { MatchService } from "@/server/features/mailbox/services/MatchService";
import { AppError } from "@/server/lib/errors";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import { normalizeDomain } from "@/shared/domain";
import {
  grantedSources,
  MAILBOX_PROVIDERS,
  SCOPE_FOR_SOURCE,
  SOURCES_BY_PROVIDER,
  type ConnectError,
  type MailboxProvider,
  type SyncSource,
} from "@/shared/mailbox";
import { hasOrgPermission } from "@/shared/org-permissions";

// A member's own mailbox connections. The Every App gateway runs the OAuth
// flow and holds the connection (providers/gateway.ts): Connect sends the
// member to the gateway's connect page, which sends them back to
// CONNECTED_PATH, where the CRM reads which mailbox the connection reaches,
// refuses one that isn't the address the member signs in with, and starts
// the sources the member granted. Everything here is the member's own, but
// suppressing a domain, which is the organization's; an owner or admin
// reaches another member's connection through MemberMailboxService.memberFor.

type Member = { organizationId: string; userId: string };

const LABEL = { google: "Google", microsoft: "Microsoft" } as const;

/** The gateway's connect page for the member. */
async function startConnect(
  provider: MailboxProvider,
  origin: string,
): Promise<{ url: string }> {
  if (!(await providerStatus(provider)).offered) {
    throw new AppError(
      "INTEGRATION_UNAVAILABLE",
      `${LABEL[provider]} isn't set up on this Every App gateway.`,
    );
  }
  return { url: await connectLink(provider, origin) };
}

type ConnectOutcome = { ok: true } | { ok: false; error: ConnectError };

/** The gateway sent the member back connected: start syncing the mailbox. */
async function completeConnect(
  member: Member & { userEmail: string },
  provider: MailboxProvider,
): Promise<ConnectOutcome> {
  const probe = await probeMailbox(
    provider,
    await mailboxFetch(member, provider),
  );
  if (probe.outcome === "not-connected") {
    return { ok: false, error: "not_connected" };
  }
  const { address: accountEmail, sources } = probe;
  if (sources.length === 0) return { ok: false, error: "scope_not_granted" };
  if (!accountEmail) return { ok: false, error: "mailbox_unknown" };
  // The member's own mailbox only, as the CRM's account linking allowed: the
  // address they sign in with, in any case.
  if (accountEmail !== member.userEmail.toLowerCase()) {
    return { ok: false, error: "email_doesn't_match" };
  }

  const previous = await ConnectionRepository.find(
    member.organizationId,
    member.userId,
    provider,
  );
  await ConnectionRepository.upsert({
    ...member,
    provider,
    accountEmail,
    scopes: sources.map((source) => SCOPE_FOR_SOURCE[source]).join(" "),
  });
  await SyncStateRepository.ensureSources({
    ...member,
    sources,
    // A different mailbox than before starts from now.
    resetCursor: Boolean(previous && previous.accountEmail !== accountEmail),
  });
  await SyncStateRepository.removeSources(
    member.organizationId,
    member.userId,
    SOURCES_BY_PROVIDER[provider].filter((source) => !sources.includes(source)),
  );
  console.log("[mailbox] connected", {
    organizationId: member.organizationId,
    userId: member.userId,
    provider,
    sources,
  });
  return { ok: true };
}

type ConnectionRow = Awaited<
  ReturnType<typeof ConnectionRepository.listForUser>
>[number];

/** A connection as Settings → Connections shows it, each source's sync too. */
export function connectionView(
  connection: ConnectionRow,
  rows: SyncRow[],
  now: string,
) {
  const granted = new Set(
    grantedSources(connection.provider, connection.scopes),
  );
  return {
    accountEmail: connection.accountEmail,
    needsReconnect: connection.status === "NEEDS_RECONNECT",
    sources: SOURCES_BY_PROVIDER[connection.provider].map((source) => {
      const row = rows.find((candidate) => candidate.source === source);
      return {
        source,
        granted: granted.has(source),
        status: row?.status ?? null,
        syncing:
          row?.status === "RUNNING" &&
          row.leaseUntil !== null &&
          row.leaseUntil > now,
        lastSyncedAt: row?.lastSyncedAt ?? null,
        lastError: row?.lastError ?? null,
        autoCreate: row?.autoCreate ?? false,
      };
    }),
  };
}

/**
 * Settings → Connections for the member: each provider, whether this
 * gateway offers it, and the member's own connection with each source's
 * sync. Owners and admins also get the command that sets the gateway up.
 */
async function status(member: Member & { role: string }) {
  const [connections, rows, gateway] = await Promise.all([
    ConnectionRepository.listForUser(member.organizationId, member.userId),
    SyncStateRepository.listForUser(member.organizationId, member.userId),
    Promise.all(MAILBOX_PROVIDERS.map((provider) => providerStatus(provider))),
  ]);
  const now = new Date().toISOString();
  const env = (await getWorkersEnv()) ?? {};
  const local = Boolean((env as { EVERYAPP_DEV?: string }).EVERYAPP_DEV);
  // Owners and admins operate the gateway too, so they set its clients.
  const showSetup =
    local || hasOrgPermission(member.role, { workspace: ["manage"] });

  const providers = MAILBOX_PROVIDERS.map((provider, index) => {
    const offered = gateway[index];
    const row = connections.find(
      (candidate) => candidate.provider === provider,
    );
    const connection = row ? connectionView(row, rows, now) : null;
    // Disconnected on the gateway (Connected accounts, or the member's
    // removal): connect again.
    const lost =
      offered?.offered &&
      (!offered.connection?.ready || offered.connection.reconnect === true);
    return {
      provider,
      ready: offered?.offered ?? false,
      // The gateway's own words for what an admin sets.
      settings: [...(offered?.settings ?? [])],
      setup: offered?.setup ?? null,
      command: showSetup ? (offered?.command ?? null) : null,
      connection:
        connection && lost
          ? { ...connection, needsReconnect: true }
          : connection,
    };
  });
  return { providers };
}

export type ConnectionsStatus = Awaited<ReturnType<typeof status>>;

async function setAutoCreate(
  member: Member,
  source: SyncSource,
  enabled: boolean,
): Promise<void> {
  const changed = await SyncStateRepository.setAutoCreate({
    ...member,
    source,
    enabled,
  });
  if (!changed) throw new AppError("NOT_FOUND", `${source} isn't connected.`);
}

/** Checks the member's sources of `provider` now. */
async function checkNow(member: Member, provider: MailboxProvider) {
  await MailboxSyncService.checkNow(
    member.organizationId,
    member.userId,
    provider,
  );
}

/**
 * "Check now" for an AI client, whose call can't outlast a check: makes the
 * member's sources of `provider` due for the minute cron's next sweep.
 */
async function queueCheck(
  member: Member,
  provider: MailboxProvider,
): Promise<{ sources: SyncSource[] }> {
  const due = await SyncStateRepository.markDue(
    member.organizationId,
    member.userId,
    SOURCES_BY_PROVIDER[provider],
  );
  const sources = SOURCES_BY_PROVIDER[provider].filter((source) =>
    due.includes(source),
  );
  if (sources.length === 0) {
    throw new AppError(
      "NOT_FOUND",
      `${LABEL[provider]} isn't connected, or needs reconnecting in Settings → Connections.`,
    );
  }
  return { sources };
}

/**
 * Deletes everything the member's mailbox brought in from `provider`. The
 * sources keep their cursors, so nothing deleted comes back.
 */
async function purgeSynced(
  member: Member,
  provider: MailboxProvider,
): Promise<{ purged: number }> {
  const { purged, targets } = await SyncedDataRepository.purgeSynced(
    member.organizationId,
    member.userId,
    provider,
  );
  await ArchiveRepository.restamp(member.organizationId, targets);
  console.log("[mailbox] synced data deleted", {
    organizationId: member.organizationId,
    userId: member.userId,
    provider,
    purged,
  });
  return { purged };
}

/**
 * "Not a customer", ported from the CRM's suppressDomain: the domain's people
 * never become contacts on their own again, from mail, meetings or website
 * forms. With `purge`, the threads and meetings already filed on its company
 * go too. Our own domains are refused: they are excluded already.
 */
async function suppressDomain(
  organizationId: string,
  input: { domain: string; reason?: string; purge: boolean },
): Promise<{ domain: string; purged: number }> {
  const domain = normalizeDomain(input.domain);
  if (!domain) {
    throw new AppError("NOT_FOUND", `"${input.domain}" is not a domain.`);
  }
  const { ourDomains } = await MatchService.internalIdentity(organizationId);
  if (ourDomains.has(domain)) {
    throw new AppError(
      "NOT_FOUND",
      "That is our own domain — it is already excluded.",
    );
  }
  await CaptureWriteRepository.suppressDomain(
    organizationId,
    domain,
    input.reason ?? null,
  );
  if (!input.purge) return { domain, purged: 0 };

  const { purged, targets } = await SyncedDataRepository.purgeDomain(
    organizationId,
    domain,
  );
  await ArchiveRepository.restamp(organizationId, targets);
  console.log("[mailbox] domain suppressed", {
    organizationId,
    domain,
    purged,
  });
  return { domain, purged };
}

/**
 * Stops capture; what was captured stays. The connection itself is the
 * gateway's: the member removes it under Connected accounts on Every App.
 */
async function disconnect(member: Member, provider: MailboxProvider) {
  await SyncStateRepository.removeSources(
    member.organizationId,
    member.userId,
    SOURCES_BY_PROVIDER[provider],
  );
  await ConnectionRepository.remove(
    member.organizationId,
    member.userId,
    provider,
  );
  console.log("[mailbox] disconnected", {
    organizationId: member.organizationId,
    userId: member.userId,
    provider,
  });
}

export const ConnectionService = {
  startConnect,
  completeConnect,
  status,
  setAutoCreate,
  checkNow,
  queueCheck,
  purgeSynced,
  suppressDomain,
  disconnect,
};
