import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { SyncStateRepository } from "@/server/features/mailbox/repositories/SyncStateRepository";
import type { MailboxProvider, SyncSource } from "@/shared/mailbox";
import { SCOPE_FOR_SOURCE } from "@/shared/mailbox";

// A member's connected mailbox, as a connect leaves it, for the sync tests:
// the connection and due rows.

export async function seedMailbox(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  accountEmail: string;
  sources: SyncSource[];
}) {
  await ConnectionRepository.upsert({
    organizationId: input.organizationId,
    userId: input.userId,
    provider: input.provider,
    accountEmail: input.accountEmail,
    scopes: input.sources.map((source) => SCOPE_FOR_SOURCE[source]).join(" "),
  });
  await SyncStateRepository.ensureSources({
    organizationId: input.organizationId,
    userId: input.userId,
    sources: input.sources,
    resetCursor: false,
  });
}
