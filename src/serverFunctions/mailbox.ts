import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  mailboxProviderSchema,
  setAutoCreateSchema,
} from "@/types/schemas/mailbox";

// Settings → Connections: every member manages their own mailbox and
// calendar connections. Agents never reach these (they are not MCP tools),
// and nothing here returns a token.

/** The CRM's own origin, which the providers send members back to. */
function origin(): string {
  return new URL(getRequest().url).origin;
}

export const getConnections = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => ConnectionService.status(context, origin()));

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
  .validator(mailboxProviderSchema)
  .handler(async ({ data, context }) =>
    ConnectionService.purgeSynced(context, data.provider),
  );

export const disconnectMailbox = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(mailboxProviderSchema)
  .handler(async ({ data, context }) => {
    await ConnectionService.disconnect(context, data.provider);
    return { ok: true };
  });
