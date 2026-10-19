import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { loggableError } from "@/server/lib/errors";
import type { MailboxProvider } from "@/shared/mailbox";

// Google and Microsoft send the member back here after consent, under the
// member's own signed-in session on the CRM's host (the gateway signs the
// identity on as on every request). The outcome goes back to the provider's
// page under Settings → Connections as `connected` or an `error` code;
// nothing else does.

export async function handleConnectCallback(
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
    const outcome = await ConnectionService.completeConnect(
      member,
      provider,
      new URL(request.url),
    );
    back = outcome.ok ? { connected: "1" } : { error: outcome.error };
  } catch (error) {
    // A failed write's message would quote the tokens it was storing.
    console.error("[mailbox] connect failed", {
      provider,
      ...loggableError(error),
    });
    back = { error: "exchange_failed" };
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: `/settings/connections/${provider}?${new URLSearchParams(back).toString()}`,
    },
  });
}
