import type { FieldEntity } from "@/shared/crm-enums";

// What a CSV import can fill on each kind of record: the built-in fields a
// column maps to, the headers that map to each on their own, and the prefix
// a custom field's target carries. The import dialog matches headers with
// these; the server reads each row's values by them (ImportService).

export type ImportTarget = {
  id: string;
  label: string;
  /** Other headers that mean this field, besides its label and id. */
  aliases: readonly string[];
  required?: boolean;
  /** What the column should hold, when the label doesn't say. */
  hint?: string;
};

const OWNER: ImportTarget = {
  id: "owner",
  label: "Owner",
  aliases: ["owner email", "account owner", "contact owner", "assigned to"],
  hint: "A member's email or name",
};

export const IMPORT_TARGETS = {
  COMPANY: [
    {
      id: "name",
      label: "Name",
      aliases: ["company", "company name", "account", "account name"],
      required: true,
    },
    {
      id: "domain",
      label: "Domain",
      aliases: [
        "website",
        "url",
        "web site",
        "company domain",
        "company website",
      ],
      hint: "acme.com, or the website",
    },
    { id: "industry", label: "Industry", aliases: [] },
    { id: "description", label: "Description", aliases: ["about"] },
    { id: "phone", label: "Phone", aliases: ["phone number", "telephone"] },
    { id: "email", label: "Email", aliases: ["company email"] },
    { id: "city", label: "City", aliases: [] },
    {
      id: "stateCode",
      label: "State",
      aliases: ["state", "region", "province"],
    },
    { id: "country", label: "Country", aliases: [] },
    {
      id: "linkedinUrl",
      label: "LinkedIn",
      aliases: ["linkedin url", "company linkedin"],
    },
    OWNER,
  ],
  CONTACT: [
    {
      id: "firstName",
      label: "First name",
      aliases: ["first", "given name", "forename"],
    },
    {
      id: "lastName",
      label: "Last name",
      aliases: ["last", "surname", "family name"],
    },
    {
      id: "fullName",
      label: "Full name",
      aliases: ["name", "contact", "contact name"],
      hint: "Split into first and last name",
    },
    {
      id: "email",
      label: "Email",
      aliases: ["email address", "work email", "e-mail"],
    },
    { id: "phone", label: "Phone", aliases: ["phone number", "mobile"] },
    {
      id: "title",
      label: "Job title",
      aliases: ["title", "position", "role"],
    },
    {
      id: "linkedinUrl",
      label: "LinkedIn",
      aliases: ["linkedin url", "linkedin profile"],
    },
    {
      id: "company",
      label: "Company",
      aliases: ["company name", "account", "organization", "company domain"],
      hint: "A company's name or domain",
    },
    OWNER,
  ],
  DEAL: [
    {
      id: "name",
      label: "Name",
      aliases: ["deal", "deal name", "opportunity", "opportunity name"],
      required: true,
    },
    {
      id: "company",
      label: "Company",
      aliases: ["company name", "account", "account name", "company domain"],
      required: true,
      hint: "A company's name or domain",
    },
    {
      id: "stage",
      label: "Stage",
      aliases: ["deal stage", "pipeline stage", "status"],
    },
    {
      id: "amount",
      label: "Amount",
      aliases: ["value", "deal value", "deal amount"],
    },
    { id: "currency", label: "Currency", aliases: ["currency code"] },
    {
      id: "closeDate",
      label: "Close date",
      aliases: ["expected close date", "expected close", "closing date"],
      hint: "A day, like 2027-03-31",
    },
    { ...OWNER, aliases: [...OWNER.aliases, "deal owner"] },
    { id: "description", label: "Description", aliases: ["notes"] },
  ],
} as const satisfies Record<FieldEntity, readonly ImportTarget[]>;

/** A custom field's target: `field:<key>`. */
export const CUSTOM_FIELD_TARGET = "field:";

/** How duplicates (by domain, email, or name and company) are handled. */
export const IMPORT_DUPLICATES = ["skip", "update"] as const;
export type ImportDuplicates = (typeof IMPORT_DUPLICATES)[number];

/**
 * Rows per request: each row is a few statements, so a chunk stays well
 * inside a Worker invocation's query budget, and every statement inside
 * D1's bound parameter limit.
 */
export const IMPORT_CHUNK_SIZE = 50;

/** The most rows one import takes. */
export const IMPORT_MAX_ROWS = 10_000;

/** What happened to one row. */
export type ImportOutcome = "created" | "updated" | "skipped" | "failed";
