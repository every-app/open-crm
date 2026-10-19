import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { MemberMailboxService } from "@/server/features/mailbox/services/MemberMailboxService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  mailboxProviderSchema,
  memberMailboxSchema,
  setAutoCreateSchema,
} from "@/types/schemas/mailbox";

// Settings → Connections: every member manages their own mailbox and
// calendar connections, and owners and admins can see everyone's, delete
// what one synced and disconnect it (a member who left). Agents never
// connect, purge or disconnect one (no MCP tool does), and nothing here
// returns a token.

/** The CRM's own origin, which the providers send members back to. */
function origin(): string {
  return new URL(getRequest().url).origin;
}

export const getConnections = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => ConnectionService.status(context, origin()));

export const getMemberConnections = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => MemberMailboxService.list(context));

export const startConnect = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(mailboxProviderSchema)
  .handler(async ({ data, context }) =>
    ConnectionService.startConnect(context, data.provider, origin()),
  );

export const checkConnectionNow = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(mailboxProviderSchema)
  .handler(async ({ data, context }) => {
    await ConnectionService.checkNow(context, data.provider);
    return { ok: true };
  });

export const setConnectionAutoCreate = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setAutoCreateSchema)
  .handler(async ({ data, context }) => {
    await ConnectionService.setAutoCreate(context, data.source, data.enabled);
    return { ok: true };
  });

export const purgeSyncedData = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(memberMailboxSchema)
  .handler(async ({ data, context }) =>
    ConnectionService.purgeSynced(
      MemberMailboxService.memberFor(context, data.userId),
      data.provider,
    ),
  );

export const disconnectMailbox = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(memberMailboxSchema)
  .handler(async ({ data, context }) => {
    await ConnectionService.disconnect(
      MemberMailboxService.memberFor(context, data.userId),
      data.provider,
    );
    return { ok: true };
  });
