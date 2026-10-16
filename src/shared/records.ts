// The three kinds of CRM record and how one is referred to across features
// (record sheets, the timeline, the agent panel, custom fields).

export const RECORD_KINDS = ["company", "contact", "deal"] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export type RecordRef = { kind: RecordKind; id: string };
