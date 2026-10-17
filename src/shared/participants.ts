import { domainFromEmail, isMachineDomain } from "@/shared/domain";

// Who is on a thread or a meeting, ported from the CRM's
// mailbox/participants.ts. `externalParticipants` is the one gate: it
// discards us (our members' addresses and our domains), what people chose to
// suppress, and addresses no person reads. Website forms apply the same
// address rules, so an address that never becomes a contact from the inbox
// never becomes one from a form. Only capture is barred from deciding these
// are people; anyone may still add them by hand.

export type Participant = {
  email: string;
  name: string | null;
};

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

/** `Name <a@b.com>` or a bare address, lowercased; null when it isn't one. */
export function parseAddress(input: string): Participant | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const angled = trimmed.match(/^(.*)<([^<>]+)>\s*$/);

  const rawEmail = (angled?.[2] ?? trimmed).trim().toLowerCase();
  if (!isEmailish(rawEmail)) return null;

  const rawName = angled?.[1]?.trim() ?? "";
  const name = rawName.replace(/^"(.*)"$/, "$1").trim();

  return { email: rawEmail, name: name || null };
}

/** A To or Cc header's people, once each; commas inside quotes don't split. */
export function parseAddressList(
  header: string | null | undefined,
): Participant[] {
  if (!header) return [];

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngles = false;

  for (const char of header) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "<") inAngles = true;
    if (char === ">") inAngles = false;

    if (char === "," && !inQuotes && !inAngles) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  const seen = new Set<string>();
  const participants: Participant[] = [];

  for (const part of parts) {
    const parsed = parseAddress(part);
    if (!parsed || seen.has(parsed.email)) continue;
    seen.add(parsed.email);
    participants.push(parsed);
  }

  return participants;
}

/** `sales@`, `noreply@`: a role or a robot, never a lead. */
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

// Deliberately narrow: a false positive is a real customer never filed.
const OPAQUE_LOCAL_PARTS = [
  /^(c_)?[0-9a-f]{24,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
];

/** A machine's address: a machine domain, or an opaque id for a local part. */
export function isMachineAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return true;

  if (isMachineDomain(email.slice(at + 1))) return true;

  const local = email.slice(0, at).toLowerCase();
  return OPAQUE_LOCAL_PARTS.some((pattern) => pattern.test(local));
}

/** Whether the name is only what `splitName` makes of the address. */
export function isDerivedName(
  email: string,
  firstName: string,
  lastName: string | null,
): boolean {
  const derived = splitName(null, email);
  return (
    derived.firstName === firstName && (derived.lastName ?? null) === lastName
  );
}

export type ExternalFilterOptions = {
  ourDomains: ReadonlySet<string>;
  ourAddresses: ReadonlySet<string>;
  suppressedDomains: ReadonlySet<string>;
  suppressedEmails: ReadonlySet<string>;
};

/** The people on a thread or meeting who could be a contact. */
export function externalParticipants(
  participants: readonly Participant[],
  options: ExternalFilterOptions,
): Participant[] {
  return participants.filter((participant) => {
    if (options.ourAddresses.has(participant.email)) return false;
    if (options.suppressedEmails.has(participant.email)) return false;
    if (isMachineAddress(participant.email)) return false;

    const domain = domainFromEmail(participant.email);
    if (!domain) return false;
    if (options.ourDomains.has(domain)) return false;
    if (options.suppressedDomains.has(domain)) return false;
    if (isAutomatedAddress(participant.email)) return false;

    return true;
  });
}

/**
 * The work domain most of the people share, a known company's breaking a
 * tie; null when nobody has one.
 */
export function dominantDomain(
  participants: readonly Participant[],
  preferKnown: ReadonlySet<string> = new Set(),
): string | null {
  const counts = new Map<string, number>();

  for (const participant of participants) {
    const domain = domainFromEmail(participant.email);
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestScore = -1;

  for (const [domain, count] of counts) {
    const score = count * 2 + (preferKnown.has(domain) ? 1 : 0);
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }

  return best;
}

type PersonName = {
  firstName: string;
  lastName: string | null;
};

/** "Ada Lovelace", "Lovelace, Ada", or failing those the address's words. */
export function splitName(name: string | null, email: string): PersonName {
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

function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
