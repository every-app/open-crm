import type { MailboxProvider, SyncSource } from "@/shared/mailbox";
import { primaryCalendar } from "./calendar";
import { gmailProfile } from "./gmail";
import { graphMe } from "./outlook";

/** The connected mailbox's address, lowercased; null when the provider won't say. */
export async function mailboxAddress(
  provider: MailboxProvider,
  accessToken: string,
  sources: SyncSource[],
): Promise<string | null> {
  const budget = { calls: 2, deadline: Date.now() + 20_000 };
  if (provider === "microsoft") {
    const me = await graphMe(accessToken, budget);
    if (me.outcome !== "ok") return null;
    return (me.data.mail ?? me.data.userPrincipalName)?.toLowerCase() ?? null;
  }
  if (sources.includes("gmail")) {
    const profile = await gmailProfile(accessToken, budget);
    return profile.outcome === "ok"
      ? (profile.data.emailAddress?.toLowerCase() ?? null)
      : null;
  }
  const calendar = await primaryCalendar(accessToken, budget);
  return calendar.outcome === "ok"
    ? (calendar.data.id?.toLowerCase() ?? null)
    : null;
}
