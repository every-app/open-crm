import { getEveryAppUser } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { SlackService } from "../services/SlackService";

// Slack's redirect back to the CRM after an owner or admin approved the
// install: `/integrations/slack/callback?code=…&state=…`. The gateway signs
// the person's identity onto it like any page; the service checks the state
// was minted for them and finishes the exchange through the gateway. A
// connect lands on the people review (as the CRM's does); anything else on
// the Slack page with why.

/** The identity's channel: "web" for a person's browser, "mcp" for an agent. */
export async function callerChannel(headers: Headers): Promise<string> {
  const user = await getEveryAppUser(
    new Request("https://crm.invalid/", { headers }),
    env,
  );
  return user?.channel ?? "mcp";
}

export async function handleSlackCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const back = (outcome: string) =>
    Response.redirect(
      outcome === "connected"
        ? `${url.origin}/settings/connections/slack/people`
        : `${url.origin}/settings/connections/slack?error=${encodeURIComponent(outcome)}`,
      302,
    );
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const outcome = await SlackService.completeConnect(context, {
      channel: await callerChannel(request.headers),
      origin: url.origin,
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    });
    return back(outcome);
  } catch (error) {
    console.error("[slack] connect failed", error);
    return back("failed");
  }
}
