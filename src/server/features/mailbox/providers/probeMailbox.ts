import type { MailboxProvider, SyncSource } from "@/shared/mailbox";
import { primaryCalendar } from "./calendar";
import { gmailProfile } from "./gmail";
import type { MailboxCall, MailboxResult } from "./mailboxApi";
import { graphMe } from "./outlook";

type MailboxProbe =
  | { outcome: "not-connected" }
  /** `address` lowercased; null when the provider won't say. */
  | { outcome: "ok"; address: string | null; sources: SyncSource[] };

/** Refused for a missing scope (Google's 403), not a passing failure. */
const granted = (result: MailboxResult<unknown>) =>
  !(result.outcome === "failed" && result.status === 403);

/**
 * What a member's new connection reaches: the mailbox's address and the
 * sources the member granted (a Google member may untick Gmail or
 * Calendar), read with one call to each.
 */
export async function probeMailbox(
  provider: MailboxProvider,
  call: MailboxCall,
): Promise<MailboxProbe> {
  const budget = { calls: 2, deadline: Date.now() + 20_000 };
  if (provider === "microsoft") {
    const me = await graphMe(call, budget);
    if (me.outcome === "not-connected") return { outcome: "not-connected" };
    const address =
      me.outcome === "ok" ? (me.data.mail ?? me.data.userPrincipalName) : null;
    return {
      outcome: "ok",
      address: address?.toLowerCase() ?? null,
      sources: ["outlook"],
    };
  }
  const [profile, calendar] = await Promise.all([
    gmailProfile(call, budget),
    primaryCalendar(call, budget),
  ]);
  if (
    profile.outcome === "not-connected" ||
    calendar.outcome === "not-connected"
  ) {
    return { outcome: "not-connected" };
  }
  const address =
    (profile.outcome === "ok" ? profile.data.emailAddress : undefined) ??
    (calendar.outcome === "ok" ? calendar.data.id : undefined);
  return {
    outcome: "ok",
    address: address?.toLowerCase() ?? null,
    sources: [
      ...(granted(profile) ? (["gmail"] as const) : []),
      ...(granted(calendar) ? (["calendar"] as const) : []),
    ],
  };
}
