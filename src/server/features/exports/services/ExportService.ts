import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import {
  ExportRepository,
  type Page,
} from "@/server/features/exports/repositories/ExportRepository";
import { FieldDefinitionRepository } from "@/server/features/fields/repositories/FieldDefinitionRepository";
import {
  FieldValueRepository,
  storedValue,
} from "@/server/features/fields/repositories/FieldValueRepository";
import type { FieldEntity } from "@/shared/crm-enums";
import { DEAL_STAGE_LABELS } from "@/shared/deal-stages";
import type { ExportDataset } from "@/types/schemas/exports";

// An owner's export of everything the organization holds (Settings →
// General): one CSV per dataset, which the browser assembles a page at a
// time, so no request holds a large workspace at once. Cells are what a
// spreadsheet needs: names and addresses instead of ids, the stages and
// options people see, and the records' dates as days, under the headers
// their import reads back.

type Cell = string | number | boolean | null;

export type ExportPage = {
  header: string[];
  rows: Cell[][];
  /** The cursor of the next page; null after the last. */
  next: string | null;
};

type Column<Row> = [header: string, value: (row: Row) => Cell];

type Rows<Read extends (...args: never[]) => Promise<unknown[]>> = Awaited<
  ReturnType<Read>
>[number];

const PAGE_SIZE: Record<ExportDataset, number> = {
  companies: 500,
  contacts: 500,
  deals: 500,
  notes: 500,
  tasks: 500,
  // Each carries a message's text.
  emails: 200,
  meetings: 500,
  "website-activity": 1000,
  "form-submissions": 500,
};

const ACTIVITY_LABELS: Record<string, string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
};

const EVENT_LABELS: Record<string, string> = {
  page_view: "Page view",
  click: "Click",
};

const day = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : null;

const fullName = (first: string | null, last: string | null) =>
  [first, last].filter(Boolean).join(" ") || null;

const recipientsSchema = z
  .array(z.object({ email: z.string(), kind: z.string().catch("to") }))
  .catch([]);

/** The addresses of one kind (to, cc) among a message's recipients. */
function addresses(recipients: unknown, kind: string): string {
  return recipientsSchema
    .parse(recipients)
    .filter((recipient) => recipient.kind === kind)
    .map((recipient) => recipient.email)
    .join("; ");
}

const formFieldsSchema = z.record(z.string(), z.string()).catch({});

/** A form's fields, a line each. */
function formFields(fields: unknown): string {
  return Object.entries(formFieldsSchema.parse(fields))
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/**
 * The entity's custom fields (archived ones too) as columns: each record's
 * value as the app shows it.
 */
async function customColumns(
  organizationId: string,
  entity: FieldEntity,
  recordIds: string[],
): Promise<Column<string>[]> {
  const fields = await FieldDefinitionRepository.list(organizationId, entity, {
    includeArchived: true,
  });
  if (fields.length === 0) return [];
  const [values, members] = await Promise.all([
    FieldValueRepository.listForRecords(organizationId, entity, recordIds),
    fields.some((field) => field.type === "USER")
      ? AuthRepository.listMembers(organizationId)
      : [],
  ]);
  const memberEmails = new Map(members.map((one) => [one.userId, one.email]));
  const byKey = new Map(
    values.map((row) => [
      `${row.fieldId}:${row.companyId ?? row.contactId ?? row.dealId}`,
      row,
    ]),
  );
  return fields.map((field) => [
    field.label,
    (recordId) => {
      const row = byKey.get(`${field.id}:${recordId}`);
      const value = row ? storedValue(field.type, row) : null;
      if (typeof value !== "string") return value;
      if (field.type === "SELECT") {
        return (
          field.options.find((option) => option.id === value)?.label ?? null
        );
      }
      if (field.type === "USER") return memberEmails.get(value) ?? value;
      return field.type === "DATE" ? day(value) : value;
    },
  ]);
}

/** The page's header and rows, the record's custom fields after its own. */
function table<Row>(
  columns: Column<Row>[],
  rows: Row[],
  custom: { columns: Column<string>[]; id: (row: Row) => string } | null,
) {
  return {
    header: [
      ...columns.map(([header]) => header),
      ...(custom?.columns ?? []).map(([header]) => header),
    ],
    rows: rows.map((row) => [
      ...columns.map(([, value]) => value(row)),
      ...(custom?.columns ?? []).map(([, value]) =>
        value(custom?.id(row) ?? ""),
      ),
    ]),
  };
}

const COMPANY: Column<Rows<typeof ExportRepository.companies>>[] = [
  ["Name", (row) => row.company.name],
  ["Domain", (row) => row.company.domain],
  ["Website", (row) => row.company.website],
  ["Description", (row) => row.company.description],
  ["Industry", (row) => row.company.industry],
  ["Sub-industry", (row) => row.company.subIndustry],
  ["City", (row) => row.company.city],
  ["State", (row) => row.company.stateCode],
  ["Country", (row) => row.company.country],
  ["Phone", (row) => row.company.phone],
  ["Email", (row) => row.company.email],
  ["LinkedIn", (row) => row.company.linkedinUrl],
  ["Twitter", (row) => row.company.twitterUrl],
  ["GitHub", (row) => row.company.githubUrl],
  ["Owner", (row) => row.ownerEmail],
  ["Source", (row) => row.company.source],
  ["Last activity", (row) => day(row.company.lastActivityAt)],
  ["Created", (row) => day(row.company.createdAt)],
  ["Archived", (row) => day(row.company.archivedAt)],
];

const CONTACT: Column<Rows<typeof ExportRepository.contacts>>[] = [
  ["First name", (row) => row.contact.firstName],
  ["Last name", (row) => row.contact.lastName],
  ["Email", (row) => row.contact.email],
  ["Phone", (row) => row.contact.phone],
  ["Job title", (row) => row.contact.title],
  ["Seniority", (row) => row.contact.seniority],
  ["Function", (row) => row.contact.function],
  ["LinkedIn", (row) => row.contact.linkedinUrl],
  ["Twitter", (row) => row.contact.twitterUrl],
  ["GitHub", (row) => row.contact.githubUrl],
  ["Company", (row) => row.companyName],
  ["Company website", (row) => row.companyDomain],
  ["Owner", (row) => row.ownerEmail],
  ["Source", (row) => row.contact.source],
  ["Last activity", (row) => day(row.contact.lastActivityAt)],
  ["Created", (row) => day(row.contact.createdAt)],
  ["Archived", (row) => day(row.contact.archivedAt)],
];

type DealRow = Rows<typeof ExportRepository.deals> & { contacts: string };

const DEAL: Column<DealRow>[] = [
  ["Name", (row) => row.deal.name],
  ["Company", (row) => row.companyName],
  ["Stage", (row) => DEAL_STAGE_LABELS[row.deal.stage]],
  ["Amount", (row) => row.deal.amount],
  ["Currency", (row) => row.deal.currency],
  ["Close date", (row) => day(row.deal.expectedCloseDate)],
  ["Closed", (row) => day(row.deal.closedAt)],
  ["Closed reason", (row) => row.deal.closedReason],
  ["Owner", (row) => row.ownerEmail],
  ["Contacts", (row) => row.contacts],
  ["Description", (row) => row.deal.description],
  ["Source", (row) => row.deal.source],
  ["Last activity", (row) => day(row.deal.lastActivityAt)],
  ["Created", (row) => day(row.deal.createdAt)],
  ["Archived", (row) => day(row.deal.archivedAt)],
];

type ActivityRow = Rows<typeof ExportRepository.activities>;

/** What an activity is on, and who wrote it (none for the agent). */
const ON: Column<ActivityRow>[] = [
  ["Company", (row) => row.companyName],
  [
    "Contact",
    (row) =>
      row.contactEmail ?? fullName(row.contactFirstName, row.contactLastName),
  ],
  ["Deal", (row) => row.dealName],
  ["Author", (row) => row.authorEmail],
];

const NOTE: Column<ActivityRow>[] = [
  ["Type", (row) => ACTIVITY_LABELS[row.activity.type] ?? row.activity.type],
  ["Subject", (row) => row.activity.subject],
  ["Body", (row) => row.activity.body],
  ["Date", (row) => row.activity.occurredAt ?? row.activity.createdAt],
  ...ON,
];

const TASK: Column<ActivityRow>[] = [
  ["Subject", (row) => row.activity.subject],
  ["Body", (row) => row.activity.body],
  ["Due", (row) => row.activity.dueAt],
  ["Completed", (row) => row.activity.completedAt],
  ...ON,
];

const EMAIL: Column<Rows<typeof ExportRepository.emails>>[] = [
  ["Thread", (row) => row.message.threadId],
  ["Sent", (row) => row.message.sentAt],
  [
    "Direction",
    (row) => (row.message.direction === "INBOUND" ? "Received" : "Sent"),
  ],
  [
    "From",
    (row) =>
      row.message.fromName
        ? `${row.message.fromName} <${row.message.fromEmail}>`
        : row.message.fromEmail,
  ],
  ["To", (row) => addresses(row.message.recipients, "to")],
  ["Cc", (row) => addresses(row.message.recipients, "cc")],
  ["Subject", (row) => row.message.subject],
  ["Body", (row) => row.message.body ?? row.message.snippet],
  ["Company", (row) => row.companyName],
  ["Contact", (row) => row.contactEmail],
];

type MeetingRow = Rows<typeof ExportRepository.meetings> & {
  attendees: string;
};

const MEETING: Column<MeetingRow>[] = [
  ["Title", (row) => row.event.title],
  ["Starts", (row) => row.event.startsAt],
  ["Ends", (row) => row.event.endsAt],
  ["All day", (row) => row.event.isAllDay],
  ["Status", (row) => row.event.status],
  ["Location", (row) => row.event.location],
  ["Conference link", (row) => row.event.conferenceUrl],
  ["Organizer", (row) => row.event.organizerEmail],
  ["Attendees", (row) => row.attendees],
  ["Description", (row) => row.event.description],
  ["Company", (row) => row.companyName],
  ["Contact", (row) => row.contactEmail],
];

const WEBSITE: Column<Rows<typeof ExportRepository.websiteActivity>>[] = [
  ["Date", (row) => row.event.occurredAt],
  ["Type", (row) => EVENT_LABELS[row.event.type] ?? row.event.type],
  ["Host", (row) => row.event.host],
  ["Path", (row) => row.event.path],
  ["Referrer", (row) => row.event.referrer],
  ["Source", (row) => row.event.source],
  ["Medium", (row) => row.event.medium],
  ["Campaign", (row) => row.event.campaign],
  ["Label", (row) => row.event.label],
  ["Visitor", (row) => row.event.visitorId],
  ["Contact", (row) => row.contactEmail],
];

const SUBMISSION: Column<Rows<typeof ExportRepository.formSubmissions>>[] = [
  ["Date", (row) => row.submission.createdAt],
  ["Host", (row) => row.submission.host],
  ["Path", (row) => row.submission.path],
  ["Email", (row) => row.submission.email],
  ["Fields", (row) => formFields(row.submission.fields)],
  ["Contact", (row) => row.contactEmail],
];

/** Each dataset's page: its rows' ids (the next cursor) and its table. */
const DATASETS: Record<
  ExportDataset,
  (
    organizationId: string,
    range: Page,
  ) => Promise<{ ids: string[] } & ReturnType<typeof table>>
> = {
  companies: async (organizationId, range) => {
    const rows = await ExportRepository.companies(organizationId, range);
    const ids = rows.map((row) => row.company.id);
    const columns = await customColumns(organizationId, "COMPANY", ids);
    return {
      ids,
      ...table(COMPANY, rows, { columns, id: (row) => row.company.id }),
    };
  },
  contacts: async (organizationId, range) => {
    const rows = await ExportRepository.contacts(organizationId, range);
    const ids = rows.map((row) => row.contact.id);
    const columns = await customColumns(organizationId, "CONTACT", ids);
    return {
      ids,
      ...table(CONTACT, rows, { columns, id: (row) => row.contact.id }),
    };
  },
  deals: async (organizationId, range) => {
    const rows = await ExportRepository.deals(organizationId, range);
    const ids = rows.map((row) => row.deal.id);
    const [columns, people] = await Promise.all([
      customColumns(organizationId, "DEAL", ids),
      ExportRepository.dealContacts(organizationId, ids),
    ]);
    const withContacts = rows.map((row) => ({
      ...row,
      contacts: people
        .filter((person) => person.dealId === row.deal.id)
        .map(
          (person) =>
            person.email ?? fullName(person.firstName, person.lastName) ?? "",
        )
        .join("; "),
    }));
    return {
      ids,
      ...table(DEAL, withContacts, { columns, id: (row) => row.deal.id }),
    };
  },
  notes: async (organizationId, range) => {
    const rows = await ExportRepository.activities(
      organizationId,
      "notes",
      range,
    );
    return {
      ids: rows.map((row) => row.activity.id),
      ...table(NOTE, rows, null),
    };
  },
  tasks: async (organizationId, range) => {
    const rows = await ExportRepository.activities(
      organizationId,
      "tasks",
      range,
    );
    return {
      ids: rows.map((row) => row.activity.id),
      ...table(TASK, rows, null),
    };
  },
  emails: async (organizationId, range) => {
    const rows = await ExportRepository.emails(organizationId, range);
    return {
      ids: rows.map((row) => row.message.id),
      ...table(EMAIL, rows, null),
    };
  },
  meetings: async (organizationId, range) => {
    const rows = await ExportRepository.meetings(organizationId, range);
    const ids = rows.map((row) => row.event.id);
    const people = await ExportRepository.attendees(organizationId, ids);
    const withAttendees = rows.map((row) => ({
      ...row,
      attendees: people
        .filter((person) => person.eventId === row.event.id)
        .map((person) => person.email)
        .join("; "),
    }));
    return { ids, ...table(MEETING, withAttendees, null) };
  },
  "website-activity": async (organizationId, range) => {
    const rows = await ExportRepository.websiteActivity(organizationId, range);
    return {
      ids: rows.map((row) => row.event.id),
      ...table(WEBSITE, rows, null),
    };
  },
  "form-submissions": async (organizationId, range) => {
    const rows = await ExportRepository.formSubmissions(organizationId, range);
    return {
      ids: rows.map((row) => row.submission.id),
      ...table(SUBMISSION, rows, null),
    };
  },
};

/** One page of one dataset of the caller's organization: owners only. */
async function page(
  caller: { organizationId: string; role: string },
  dataset: ExportDataset,
  cursor: string | null,
): Promise<ExportPage> {
  requireOrgPermission(caller, { workspace: ["export"] });
  const range = { after: cursor, limit: PAGE_SIZE[dataset] };
  const { ids, header, rows } = await DATASETS[dataset](
    caller.organizationId,
    range,
  );
  return {
    header,
    rows,
    next: ids.length === range.limit ? (ids.at(-1) ?? null) : null,
  };
}

export const ExportService = { page };
