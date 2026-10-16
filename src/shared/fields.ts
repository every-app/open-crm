import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import { normalizeEmail } from "@/shared/domain";
import { safeHttpUrl } from "@/shared/safe-url";

// Custom fields: what each type means, how a field's key is made, and what
// counts as a value of it. The server validates every write with
// parseFieldValue, people's and the agent's alike, and the client runs the
// same check before it sends anything.

/** A custom field's value as the API, the agent and the UI exchange it. */
export type FieldValueJson = string | number | boolean | null;

export const FIELD_TYPE_LABELS = {
  TEXT: "Text",
  LONG_TEXT: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SELECT: "Select",
  URL: "URL",
  EMAIL: "Email",
  PHONE: "Phone",
  USER: "User",
} as const satisfies Record<FieldType, string>;

/** What a record of each entity is called, singular and plural. */
export const ENTITY_NOUNS = {
  COMPANY: { one: "company", many: "companies", title: "Companies" },
  CONTACT: { one: "contact", many: "contacts", title: "Contacts" },
  DEAL: { one: "deal", many: "deals", title: "Deals" },
} as const satisfies Record<
  FieldEntity,
  { one: string; many: string; title: string }
>;

export const FIELD_LABEL_MAX = 80;
export const FIELD_BRIEF_MAX = 2000;
export const FIELD_OPTION_LABEL_MAX = 100;
export const FIELD_OPTIONS_MAX = 100;

export function usesOptions(type: FieldType): boolean {
  return type === "SELECT";
}

// Keys the record APIs already use, and the editor's "new" sentinel.
const RESERVED_KEYS = new Set([
  "id",
  "createdat",
  "updatedat",
  "fields",
  "owner",
  "ownerid",
  "new",
]);

/**
 * The key the API and the agent use for a field, made once from its label:
 * "Runs on" is `runs_on`. Empty when the label has no letters or digits.
 */
export function fieldKeyFromLabel(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "f_$1")
    .slice(0, 60);

  return RESERVED_KEYS.has(key) ? `${key}_field` : key;
}

/** What parseFieldValue needs to know about a field. */
export type ValueField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: readonly { id: string; label: string; archived?: boolean }[];
};

type ParsedFieldValue =
  | { ok: true; value: FieldValueJson }
  | { ok: false; message: string };

const TEXT_MAX = {
  TEXT: 1000,
  LONG_TEXT: 20_000,
  URL: 2048,
  EMAIL: 254,
  PHONE: 50,
} as const;

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Checks `input` against the field's type and returns the value as it is
 * stored and read back: trimmed text, a number rounded to 4 decimals, a date
 * as its day's UTC midnight (an ISO timestamp), a select's option id, a user
 * id. Blank input clears the field, unless it is required. A user id is
 * only checked for shape here; the server checks they work here.
 */
export function parseFieldValue(
  field: ValueField,
  input: unknown,
): ParsedFieldValue {
  if (
    input === null ||
    input === undefined ||
    (typeof input === "string" && input.trim() === "")
  ) {
    return field.required
      ? fail(`${field.label} cannot be empty.`)
      : { ok: true, value: null };
  }

  if (
    typeof input !== "string" &&
    typeof input !== "number" &&
    typeof input !== "boolean"
  ) {
    return fail(
      "A field holds text, a number, true or false, or nothing at all.",
    );
  }

  const raw = String(input).trim();

  switch (field.type) {
    case "CHECKBOX": {
      if (typeof input === "boolean") return { ok: true, value: input };
      if (raw === "true" || raw === "false") {
        return { ok: true, value: raw === "true" };
      }
      return fail(`${field.label} takes true or false.`);
    }

    case "NUMBER": {
      const parsed = typeof input === "number" ? input : Number(raw);
      const rounded = Math.round(parsed * 10_000) / 10_000;
      if (
        typeof input === "boolean" ||
        (typeof input === "string" && !NUMBER.test(raw)) ||
        !Number.isFinite(rounded)
      ) {
        return fail(`${field.label} takes a number.`);
      }
      return { ok: true, value: rounded };
    }

    case "DATE": {
      // A date is a day: the one written, at UTC midnight. A time is dropped.
      const day = raw.slice(0, 10);
      return (ISO_DAY.test(raw) || ISO_DATE_TIME.test(raw)) &&
        isCalendarDay(day)
        ? { ok: true, value: `${day}T00:00:00.000Z` }
        : fail(`${field.label} takes a date like 2027-03-31.`);
    }

    case "SELECT": {
      const wanted = raw.toLowerCase();
      const option =
        field.options.find((entry) => !entry.archived && entry.id === raw) ??
        field.options.find(
          (entry) => !entry.archived && entry.label.toLowerCase() === wanted,
        );
      return option
        ? { ok: true, value: option.id }
        : fail(`${field.label} has no option "${raw}".`);
    }

    case "USER":
      return raw.length <= 200
        ? { ok: true, value: raw }
        : fail(`${field.label} takes someone who works here.`);

    default:
      return parseText(field.label, field.type, raw);
  }
}

function fail(message: string): ParsedFieldValue {
  return { ok: false, message };
}

function parseText(
  label: string,
  type: keyof typeof TEXT_MAX,
  raw: string,
): ParsedFieldValue {
  switch (type) {
    case "URL": {
      const url = normalizeUrl(raw);
      return url && url.length <= TEXT_MAX.URL
        ? { ok: true, value: url }
        : fail(`${label} takes a web address like acme.com.`);
    }
    case "EMAIL": {
      const email = normalizeEmail(raw);
      return email && email.length <= TEXT_MAX.EMAIL
        ? { ok: true, value: email }
        : fail(`${label} takes an email address.`);
    }
    case "PHONE":
      return /\d/.test(raw) && raw.length <= TEXT_MAX.PHONE
        ? { ok: true, value: raw }
        : fail(`${label} takes a phone number.`);
    default:
      return raw.length <= TEXT_MAX[type]
        ? { ok: true, value: raw }
        : fail(`${label} is too long.`);
  }
}

/** Whether YYYY-MM-DD is a real day (not February 30th). */
function isCalendarDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
}

/** An http(s) address, given a scheme when it has none, or null. */
function normalizeUrl(raw: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  const safe = safeHttpUrl(withScheme);
  if (!safe) return null;
  return new URL(safe).hostname.includes(".") ? safe : null;
}
