import {
  ConfigurationError,
  connectUrl,
  integrationFetch,
  integrationStatus,
} from "@every-app/sdk/server";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import type { MailboxProvider } from "@/shared/mailbox";

// Mail and calendar through the Every App gateway's connections
// (`google-workspace`, `microsoft-365`): the gateway runs the OAuth flow,
// holds each member's tokens and puts them on the CRM's calls to Gmail,
// Calendar and Graph. The CRM never sees a token. A connection is one
// member's, made for the CRM; every call names whose it uses.

const CAPABILITY = {
  google: "google-workspace",
  microsoft: "microsoft-365",
} as const satisfies Record<MailboxProvider, string>;

/** Where the gateway sends the member back to after connecting. */
const CONNECTED_PATH = {
  google: "/integrations/google/connected",
  microsoft: "/integrations/microsoft/connected",
} as const satisfies Record<MailboxProvider, string>;

async function gatewayEnv(): Promise<object> {
  return (await getWorkersEnv()) ?? {};
}

/**
 * The calls to `provider`'s API on `member`'s own connection, whoever
 * started the work (the member, an owner's Check now, the minute cron).
 */
export async function mailboxFetch(
  member: { organizationId: string; userId: string },
  provider: MailboxProvider,
): Promise<typeof fetch> {
  return integrationFetch({
    env: await gatewayEnv(),
    provider: CAPABILITY[provider],
    for: {
      background: true,
      organizationId: member.organizationId,
      userId: member.userId,
    },
  });
}

/**
 * Whether the gateway offers `provider` to the CRM, what an admin sets
 * when it doesn't, and, asked while serving a member, their own connection
 * on the gateway. The minute cron asks as background work.
 */
export async function providerStatus(provider: MailboxProvider) {
  try {
    const env = await gatewayEnv();
    const status = await integrationStatus({
      env,
      provider: CAPABILITY[provider],
      for: gatewayCallFor(env) ?? { background: true },
    });
    return {
      offered: status.requested && status.configured,
      settings: status.settings,
      setup: status.setup,
      command: status.command,
      connection: status.connection ?? null,
    };
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    return {
      offered: false,
      settings: [] as readonly string[],
      setup: error.message,
      command: null,
      connection: null,
    };
  }
}

/** The gateway's connect page for `provider`, which comes back to `origin`. */
export async function connectLink(
  provider: MailboxProvider,
  origin: string,
): Promise<string> {
  return connectUrl({
    env: await gatewayEnv(),
    provider: CAPABILITY[provider],
    returnTo: `${origin}${CONNECTED_PATH[provider]}`,
  });
}
