import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { loggableError } from "@/server/lib/errors";
import type { MailboxProvider } from "@/shared/mailbox";

// The gateway sends the member back here once they have connected, under
// their own signed-in session on the CRM's host. The CRM then reads which
// mailbox it is and starts syncing it. The outcome goes back to the
// provider's page under Settings → Connections as `connected` or an `error`
// code. A refused or cancelled consent stays on the gateway's own page.

export async function handleConnected(
  request: Request,
  provider: MailboxProvider,
): Promise<Response> {
  let member;
  try {
    member = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Sign in on Every App, then connect again.", {
      status: 401,
    });
  }
  let back: Record<string, string>;
  try {
    const outcome = await ConnectionService.completeConnect(member, provider);
    back = outcome.ok ? { connected: "1" } : { error: outcome.error };
  } catch (error) {
    console.error("[mailbox] connect failed", {
      provider,
      ...loggableError(error),
    });
    back = { error: "mailbox_unknown" };
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: `/settings/connections/${provider}?${new URLSearchParams(back)}`,
    },
  });
}
