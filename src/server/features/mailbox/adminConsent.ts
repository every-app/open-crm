import { CALLBACK_PATH } from "@/server/features/mailbox/providers/oauth";
import { REQUESTED_SCOPES, type MailboxProvider } from "@/shared/mailbox";

// Microsoft 365 organizations where only an admin may consent to an app: the
// default for mail, and for any app from an unverified publisher. The member
// meets Microsoft's "Need admin approval" page. Leaving it comes back as a
// declined consent (AADSTS65004, as a cancelled consent does); a policy that
// refuses outright comes back as `consent_required` or one of these codes.
// Either way the connect comes back as `access_denied`, and the provider's
// page offers the admin consent for the member's organization.

const CONSENT_CODES = /\bAADSTS(?:65001|65004|90093|90094|90095|900941)\b/;

/**
 * What a provider's refusal comes back as: a declined consent, Microsoft's
 * organizations' refusals included, as `access_denied`; anything else as
 * `exchange_failed`.
 */
export function refusalOf(
  provider: MailboxProvider,
  error: string | null,
  description: string | null,
): "access_denied" | "exchange_failed" {
  const declined =
    error === "access_denied" ||
    (provider === "microsoft" &&
      (error === "consent_required" || CONSENT_CODES.test(description ?? "")));
  return declined ? "access_denied" : "exchange_failed";
}

/**
 * Microsoft's admin consent for the organization the member's address
 * belongs to (a verified domain names its tenant): an admin who opens it
 * grants the CRM's scopes to everyone there, then comes back to the connect
 * callback.
 */
export function adminConsentUrl(input: {
  clientId: string;
  origin: string;
  email: string;
}): string {
  const tenant = input.email
    .slice(input.email.lastIndexOf("@") + 1)
    .toLowerCase();
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/adminconsent`,
  );
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set(
    "scope",
    REQUESTED_SCOPES.microsoft
      .map((scope) =>
        scope === "offline_access"
          ? scope
          : `https://graph.microsoft.com/${scope}`,
      )
      .join(" "),
  );
  url.searchParams.set(
    "redirect_uri",
    `${input.origin}${CALLBACK_PATH.microsoft}`,
  );
  return url.toString();
}
