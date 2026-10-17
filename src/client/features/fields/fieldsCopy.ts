import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";

// The fields sheet's words, from the CRM. The product says "your agents",
// never the runtime's name.

export const SHEET_TITLE = "Fields";

export function sheetSubtitle(entity: FieldEntity): string {
  return `This shapes every ${ENTITY_NOUNS[entity].one} in your CRM.`;
}

export const STANDARD_ROW = "Standard fields";
export const STANDARD_NOTE = "reorder and hide only";
export const SUGGESTED_ROW = "Suggested fields";
export const SUGGESTED_NOTE = "one click to add";
export const CUSTOM_GROUP = "Custom fields";
export const ARCHIVED_ROW = "Archived";
export const ARCHIVED_NOTE = "values kept, hidden everywhere";
export const NEW_FIELD = "New field";
export const ORDER_NOTE = "Order here is the order on the sheet";
export const MANUAL_ONLY = "Manual only";
export const TABLE_NOTE = "also a column on the table";
export const FILTER_NOTE = "also a filter";
export const MANAGE_HINT = "Only an owner or an admin can change fields.";

export const EMPTY_TITLE = "No custom fields yet";
export const EMPTY_BODY =
  "Create dynamic fields that your agents can research and pre-fill.";
export const EMPTY_BODY_READ_ONLY =
  "An owner or an admin adds the fields everyone fills in here.";

export const ERROR_TITLE = "We could not load your fields";
export const ERROR_BODY =
  "Your fields are still there. Try again in a moment, before you create anything new.";

export const LABEL_LABEL = "Label";
export const KEY_LABEL = "Key";
export const KEY_HELP =
  "What the API and your agents call it. Set from the label, fixed once saved — renaming the label later never breaks a caller.";
export const AGENT_LABEL = "Let your agents fill this";
export const AGENT_HELP =
  "They fill it on records where it's empty, from sources they can cite.";
export const BRIEF_LABEL = "What counts as an answer";
export const BRIEF_HELP =
  "Leave it empty and your agents work from the label and type alone.";
export const TYPE_LABEL = "Type";
export const TYPE_LOCKED =
  "It holds values, so its type is fixed. Archive it and make a new field to change it.";
export const OPTIONS_LABEL = "Options";
export const ADD_OPTION = "Add option";
export const CREATE_FIELD = "Create field";
export const SAVE = "Save changes";
export const ARCHIVE = "Archive";
export const FILL = "Ask the agent to fill";
export const ALL_FILLED = "Nothing left to fill";

export const TYPE_HINTS = {
  TEXT: "Text — a short line",
  LONG_TEXT: "Long text — a paragraph",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox — yes or no",
  SELECT: "Select — one of a fixed list",
  URL: "URL",
  EMAIL: "Email",
  PHONE: "Phone",
  USER: "User — someone in the workspace",
} as const satisfies Record<FieldType, string>;

export function sheetPlacement(entity: FieldEntity): string {
  return `Show on the ${ENTITY_NOUNS[entity].one} sheet`;
}

export function tablePlacement(entity: FieldEntity): string {
  return `Offer as a column on the ${ENTITY_NOUNS[entity].title} table`;
}

export function filterPlacement(entity: FieldEntity): string {
  return `Offer as a filter on the ${ENTITY_NOUNS[entity].title} table`;
}

/** The record fields every entity has, which the sheet lists but can't change. */
export const STANDARD_FIELDS = {
  COMPANY: [
    "Name",
    "Domain",
    "Website",
    "Phone",
    "Email",
    "City",
    "Country",
    "Owner",
  ],
  CONTACT: [
    "First name",
    "Last name",
    "Title",
    "Email",
    "Phone",
    "LinkedIn",
    "GitHub",
    "Company",
    "Owner",
  ],
  DEAL: [
    "Name",
    "Amount",
    "Currency",
    "Close date",
    "Company",
    "Owner",
    "Stage",
  ],
} as const satisfies Record<FieldEntity, readonly string[]>;

type FieldTemplate = {
  label: string;
  type: "SELECT" | "USER" | "NUMBER";
  options?: readonly string[];
};

/** Fields most CRMs end up adding, one click away. */
export const SUGGESTED_FIELDS = {
  COMPANY: [
    {
      label: "Account type",
      type: "SELECT",
      options: ["Prospect", "Customer", "Partner", "Churned"],
    },
    {
      label: "Segment",
      type: "SELECT",
      options: ["Enterprise", "Mid-Market", "SMB"],
    },
    { label: "Territory", type: "SELECT", options: ["AMER", "EMEA", "APAC"] },
    {
      label: "Lifecycle stage",
      type: "SELECT",
      options: ["Lead", "MQL", "SQL", "Opportunity", "Customer"],
    },
    {
      label: "Lead source",
      type: "SELECT",
      options: ["Inbound", "Outbound", "Event"],
    },
    { label: "ICP fit score", type: "NUMBER" },
    { label: "BDR owner", type: "USER" },
  ],
  CONTACT: [],
  DEAL: [],
} as const satisfies Record<FieldEntity, readonly FieldTemplate[]>;
