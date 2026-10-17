// The CRM's enumerated values, shared by both database dialects, the server
// and the client. The database stores them as text with these values.

export const DEAL_STAGES = [
  "DEMO_BOOKED",
  "QUALIFIED_TO_BUY",
  "UNQUALIFIED_TO_BUY",
  "DECISION_MAKER_BOUGHT_IN",
  "CONTRACT_SENT",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
  "TASK",
  "STAGE_CHANGE",
  "ENRICHMENT",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ENRICHMENT_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETE",
  "FAILED",
  "SKIPPED",
] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

export const RECORD_SOURCES = [
  "MANUAL",
  "IMPORT",
  "EMAIL",
  "CALENDAR",
  "TRACKING",
] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

export const FACT_BANDS = ["VERIFIED", "PROBABLE", "POSSIBLE"] as const;
export type FactBand = (typeof FACT_BANDS)[number];

export const FACT_STATUSES = [
  "APPLIED",
  "PROPOSED",
  "DISMISSED",
  "SUPERSEDED",
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const FIELD_ENTITIES = ["COMPANY", "CONTACT", "DEAL"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export const FIELD_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "DATE",
  "CHECKBOX",
  "SELECT",
  "URL",
  "EMAIL",
  "PHONE",
  "USER",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const EMAIL_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export const AGENT_CONVERSATION_KINDS = ["RECORD", "BUILDER"] as const;
