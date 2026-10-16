// Name and handle comparisons the agent uses to decide whether a profile, a
// team-page entry or an email address is the person on the record. Ported
// from the CRM's lib/names.ts. Deliberately no fuzzy matching: "Marchetti"
// reaching "Marchetta" is a wrong record about a real person.

export function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

function nameMatchesLocalPart(
  person: { firstName: string | null; lastName: string | null },
  local: string,
): boolean {
  const first = normalise(person.firstName ?? "");
  const last = normalise(person.lastName ?? "");
  const handle = normalise(local);
  if (!handle || (!first && !last)) return false;
  const forms = [
    `${first}${last}`,
    `${last}${first}`,
    `${first.slice(0, 1)}${last}`,
    `${last}${first.slice(0, 1)}`,
    `${first}${last.slice(0, 1)}`,
    first,
    last,
  ].filter(Boolean);
  return forms.some(
    (form) =>
      form === handle || form.startsWith(handle) || handle.startsWith(form),
  );
}

/**
 * Whether the contact's only name is one derived from their email address
 * (a placeholder the agent may replace), rather than one a person typed.
 */
export function isDerivedName(
  email: string | null,
  firstName: string,
  lastName: string | null,
): boolean {
  if (!email || lastName !== null) return false;
  const local = email.split("@")[0] ?? "";
  return nameMatchesLocalPart({ firstName, lastName: null }, local);
}

/** Same full name, or the same first and last word of one. */
export function namesMatch(a: string | null, b: string | null): boolean {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left.join("") === right.join("")) return true;
  if (left.length < 2 || right.length < 2) return false;
  return left[0] === right[0] && left.at(-1) === right.at(-1);
}

function words(value: string | null): string[] {
  return (value ?? "")
    .split(/\s+/)
    .map(normalise)
    .filter((word) => word.length > 1);
}

export function fullName(person: {
  firstName: string;
  lastName: string | null;
}): string {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
