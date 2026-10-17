import type { FieldEntity } from "@/shared/crm-enums";
import { CUSTOM_FIELD_TARGET, IMPORT_TARGETS } from "@/shared/imports";

// Which field each CSV column goes into: the built-in fields of the kind of
// record (IMPORT_TARGETS) and its custom fields, matched to the headers by
// name and edited by the person before anything is sent.

export type Target = {
  id: string;
  label: string;
  required: boolean;
  hint?: string;
  /** Normalized names a header matches. */
  names: string[];
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Where a column of `entity` can go: built-in fields, then custom ones. */
export function importTargets(
  entity: FieldEntity,
  customFields: { key: string; label: string }[],
): Target[] {
  return [
    ...IMPORT_TARGETS[entity].map((target) => ({
      id: target.id,
      label: target.label,
      required: "required" in target && target.required === true,
      hint: "hint" in target ? target.hint : undefined,
      names: [target.label, target.id, ...target.aliases].map(normalize),
    })),
    ...customFields.map((field) => ({
      id: `${CUSTOM_FIELD_TARGET}${field.key}`,
      label: field.label,
      required: false,
      names: [field.label, field.key].map(normalize),
    })),
  ];
}

/**
 * Each header's target by name (null: not imported). A target takes the
 * first column that names it; a built-in field wins over a custom field of
 * the same name.
 */
export function autoMap(
  headers: string[],
  targets: Target[],
): (string | null)[] {
  const taken = new Set<string>();
  return headers.map((header) => {
    const name = normalize(header);
    const target = targets.find(
      (candidate) => !taken.has(candidate.id) && candidate.names.includes(name),
    );
    if (!target) return null;
    taken.add(target.id);
    return target.id;
  });
}

/** What's still needed before the rows can go: the required fields, by label. */
export function missingTargets(
  entity: FieldEntity,
  mapping: (string | null)[],
  targets: Target[],
): string[] {
  const mapped = new Set(mapping);
  // A contact's first name may come from its full name.
  if (
    entity === "CONTACT" &&
    !mapped.has("firstName") &&
    !mapped.has("fullName")
  ) {
    return ["First name (or Full name)"];
  }
  return targets
    .filter((target) => target.required && !mapped.has(target.id))
    .map((target) => target.label);
}

/** The rows as the server takes them: values keyed by target, line numbers from 2. */
export function mappedRows(
  rows: string[][],
  mapping: (string | null)[],
): { line: number; values: Record<string, string> }[] {
  return rows.map((row, index) => {
    const values: Record<string, string> = {};
    mapping.forEach((target, column) => {
      const value = row[column];
      if (target && value) values[target] = value;
    });
    // Line 1 is the header.
    return { line: index + 2, values };
  });
}
