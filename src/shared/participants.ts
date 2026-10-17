import { isMachineDomain } from "@/shared/domain";

// Whether an address belongs to a person who could become a contact, as the
// CRM's mailbox pipeline judges it (apps/api/src/mailbox/participants.ts):
// captured mail and website forms apply the same rules, so an address that
// never becomes a contact from the inbox never becomes one from a form.

const AUTOMATED_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
  "auto-confirm",
  "automated",
  "calendar-invite",
  "calendar",
  "invite",
  "invites",
  "invitations",
  "meetings",
  "scheduling",
  "booking",
  "bookings",
  "reply",
  "support",
  "help",
  "hello",
  "info",
  "contact",
  "sales",
  "billing",
  "accounts",
  "team",
];

/** A shared or automated mailbox (noreply@, sales@, support+x@, …). */
export function isAutomatedAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return true;
  return AUTOMATED_LOCAL_PARTS.some(
    (pattern) =>
      local === pattern ||
      local.startsWith(`${pattern}-`) ||
      local.startsWith(`${pattern}+`) ||
      local.startsWith(`${pattern}_`),
  );
}

const OPAQUE_LOCAL_PARTS = [
  /^(c_)?[0-9a-f]{24,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
];

/** A machine's address: a machine domain, or an opaque generated local part. */
export function isMachineAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return true;
  if (isMachineDomain(email.slice(at + 1))) return true;
  const local = email.slice(0, at).toLowerCase();
  return OPAQUE_LOCAL_PARTS.some((pattern) => pattern.test(local));
}

/**
 * A person's first and last name from a display name ("Ana Zed", "Zed,
 * Ana"), or from their address's local part (ana.zed@ → Ana Zed).
 */
export function personName(
  name: string | null,
  email: string,
): { firstName: string; lastName: string | null } {
  const cleaned = name?.trim().replace(/\s+/g, " ") ?? "";
  if (cleaned && !cleaned.includes("@")) {
    const comma = cleaned.match(/^([^,]+),\s*(.+)$/);
    if (comma?.[1] && comma[2]) {
      return { firstName: comma[2].trim(), lastName: comma[1].trim() };
    }
    const [first, ...rest] = cleaned.split(" ");
    if (first) {
      return {
        firstName: first,
        lastName: rest.length > 0 ? rest.join(" ") : null,
      };
    }
  }
  const local = email.split("@")[0] ?? email;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const [first, ...rest] = words;
  if (!first) return { firstName: email, lastName: null };
  return {
    firstName: first,
    lastName: rest.length > 0 ? rest.join(" ") : null,
  };
}
