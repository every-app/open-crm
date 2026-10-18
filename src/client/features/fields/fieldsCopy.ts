import type { FieldEntity } from "@/shared/crm-enums";

// The fields sheet's words, from the CRM. The product says "your agents",
// never the runtime's name.

export const SHEET_TITLE = "Fields";

export const STANDARD_ROW = "Standard fields";
export const SUGGESTED_ROW = "Suggested fields";
export const CUSTOM_GROUP = "Custom fields";
export const ARCHIVED_ROW = "Archived";
export const NEW_FIELD = "New field";
export const MANUAL_ONLY = "Manual only";
export const TABLE_NOTE = "table column";
export const FILTER_NOTE = "filter";
export const MANAGE_HINT = "Only an owner or an admin can change fields.";

export const EMPTY_TITLE = "No custom fields yet";

export const ERROR_TITLE = "We could not load your fields";
export const ERROR_BODY = "Try again before you create a field.";

export const LABEL_LABEL = "Label";
export const KEY_LABEL = "Key";
export const KEY_HELP = "Fixed once saved.";
export const AGENT_LABEL = "Let your agents fill this";
export const AGENT_HELP = "Only where it's empty.";
export const BRIEF_LABEL = "What counts as an answer";
export const TYPE_LABEL = "Type";
export const TYPE_LOCKED = "Fixed once it holds values.";
export const OPTIONS_LABEL = "Options";
export const ADD_OPTION = "Add option";
export const CREATE_FIELD = "Create field";
export const SAVE = "Save";
export const ARCHIVE = "Archive";
export const FILL = "Ask the agent to fill";
export const ALL_FILLED = "Nothing left to fill";

export const SHEET_PLACEMENT = "Show on the sheet";
export const TABLE_PLACEMENT = "Offer as a column";
export const FILTER_PLACEMENT = "Offer as a filter";

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
