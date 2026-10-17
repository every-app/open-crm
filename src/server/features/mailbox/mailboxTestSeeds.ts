import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { SyncStateRepository } from "@/server/features/mailbox/repositories/SyncStateRepository";
import type { MailboxProvider, SyncSource } from "@/shared/mailbox";
import { SCOPE_FOR_SOURCE } from "@/shared/mailbox";

// A member's connected mailbox, as the connect callback leaves it, for the
// sync tests: an unexpired access token unless `expired`, and due rows.

export async function seedMailbox(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  accountEmail: string;
  sources: SyncSource[];
  expired?: boolean;
  refreshToken?: string;
}) {
  await ConnectionRepository.upsert({
    organizationId: input.organizationId,
    userId: input.userId,
    provider: input.provider,
    accountEmail: input.accountEmail,
    scopes: input.sources.map((source) => SCOPE_FOR_SOURCE[source]).join(" "),
    accessToken: "stored-access",
    accessTokenExpiresAt: new Date(
      Date.now() + (input.expired ? -1 : 1) * 3600_000,
    ).toISOString(),
    refreshToken: input.refreshToken ?? "stored-refresh",
  });
  await SyncStateRepository.ensureSources({
    organizationId: input.organizationId,
    userId: input.userId,
    sources: input.sources,
    resetCursor: false,
  });
}
