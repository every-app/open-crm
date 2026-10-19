/* eslint-disable max-lines -- CRM table declarations */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
  ACTIVITY_TYPES,
  DEAL_STAGES,
  EMAIL_DIRECTIONS,
  ENRICHMENT_STATUSES,
  FACT_BANDS,
  FACT_STATUSES,
  FIELD_ENTITIES,
  FIELD_TYPES,
  RECORD_SOURCES,
} from "../shared/crm-enums";
import {
  CONNECTION_STATUSES,
  MAILBOX_PROVIDERS,
  SYNC_SOURCES,
  SYNC_STATUSES,
} from "../shared/mailbox";
import { organization, user } from "./auth.schema";
import { isoNow, timestamp } from "./columns";

// Every CRM table hangs off `organization_id` (cascade), as every OpenSEO
// product table does. Repositories filter by it on every read and write.
//
// Deleting a record follows its foreign keys into other tables (deleting
// the rows, or setting the key to null), so each such key also has an
// index led by the key itself: with only one led by `organization_id`, the
// database scans every organization's rows for each record deleted.

const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const createdAt = () => timestamp("created_at").notNull().default(isoNow);
const updatedAt = () => timestamp("updated_at").notNull().default(isoNow);

/** The organization's workspace: its name, website and CRM settings. */
export const workspace = sqliteTable("workspace", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  website: text("website"),
  // Set once onboarding (name and website) is done.
  onboardedAt: timestamp("onboarded_at"),
  // The currency deal totals are reported in; null is USD.
  reportingCurrency: text("reporting_currency"),
  ratesRefreshedAt: timestamp("rates_refreshed_at"),
  // Days an archived record is kept before it is purged.
  archiveRetentionDays: integer("archive_retention_days")
    .notNull()
    .default(180),
  // The agent's model as last seen through the gateway: when the gateway
  // refused it for want of a key (and its message), and when it last
  // answered. The later of the two is the model's state.
  modelRefusedAt: timestamp("model_refused_at"),
  modelRefusal: text("model_refusal"),
  modelAnsweredAt: timestamp("model_answered_at"),
  // When the enrichment sweep last looked over the organization's records
  // (src/server/features/agent/dispatch/sweep.ts).
  enrichmentSweptAt: timestamp("enrichment_swept_at"),
  // Whether the agent researches on its own (Settings → General): new
  // records, and what the enrichment sweep finds. Off, only what a person
  // asks for runs.
  researchAutomatically: integer("research_automatically", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** What the agent learned about the organization's own business. */
export const workspaceProfile = sqliteTable("workspace_profile", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  website: text("website").notNull(),
  narrative: text("narrative").notNull(),
  sections: text("sections", { mode: "json" }).$type<unknown>().notNull(),
  sourceUrl: text("source_url"),
  sessionId: text("session_id"),
  refreshedAt: timestamp("refreshed_at").notNull().default(isoNow),
});

export const company = sqliteTable(
  "company",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    domain: text("domain"),
    website: text("website"),
    description: text("description"),

    logoUrl: text("logo_url"),
    logoDarkUrl: text("logo_dark_url"),
    iconUrl: text("icon_url"),
    iconDarkUrl: text("icon_dark_url"),
    iconTone: text("icon_tone"),
    brandColor: text("brand_color"),

    industry: text("industry"),
    subIndustry: text("sub_industry"),
    city: text("city"),
    stateCode: text("state_code"),
    country: text("country"),
    countryCode: text("country_code"),

    phone: text("phone"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    twitterUrl: text("twitter_url"),
    githubUrl: text("github_url"),
    pricingUrl: text("pricing_url"),
    careersUrl: text("careers_url"),

    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    primaryContactId: text("primary_contact_id").references(
      (): AnySQLiteColumn => contact.id,
      { onDelete: "set null" },
    ),

    enrichmentStatus: text("enrichment_status", { enum: ENRICHMENT_STATUSES })
      .notNull()
      .default("PENDING"),
    enrichedAt: timestamp("enriched_at"),
    enrichmentError: text("enrichment_error"),
    // Set while the record's paid research waits for a person: added by a
    // website form or a calendar invite (until someone opens or enriches
    // it), or imported with research off (until someone enriches it).
    researchHeldAt: timestamp("research_held_at"),

    source: text("source", { enum: RECORD_SOURCES })
      .notNull()
      .default("MANUAL"),

    lastActivityAt: timestamp("last_activity_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One live company per domain in an organization; archived ones keep
    // theirs so a restore can find it.
    uniqueIndex("company_organization_domain_active_uidx")
      .on(table.organizationId, table.domain)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex("company_primary_contact_uidx").on(table.primaryContactId),
    index("company_organization_owner_idx").on(
      table.organizationId,
      table.ownerId,
    ),
    index("company_organization_name_idx").on(table.organizationId, table.name),
    index("company_organization_last_activity_idx").on(
      table.organizationId,
      table.lastActivityAt,
    ),
    index("company_organization_archived_idx").on(
      table.organizationId,
      table.archivedAt,
    ),
    // The lists' default order, newest first.
    index("company_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

/** The raw Context.dev answer behind a company's brand data. */
export const companyEnrichment = sqliteTable("company_enrichment", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  organizationId: organizationId(),
  source: text("source").notNull().default("context.dev"),
  raw: text("raw", { mode: "json" }).$type<unknown>().notNull(),
  fetchedAt: timestamp("fetched_at").notNull().default(isoNow),
});

export const contact = sqliteTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    // Stored lowercased, so the active-email index is case-insensitive.
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    seniority: text("seniority"),
    function: text("function"),
    linkedinUrl: text("linkedin_url"),
    twitterUrl: text("twitter_url"),
    githubUrl: text("github_url"),
    imageUrl: text("image_url"),

    socialsCheckedAt: timestamp("socials_checked_at"),

    enrichmentStatus: text("enrichment_status", { enum: ENRICHMENT_STATUSES })
      .notNull()
      .default("PENDING"),
    enrichedAt: timestamp("enriched_at"),
    enrichmentError: text("enrichment_error"),
    // Set while the record's paid research waits for a person: added by a
    // website form or a calendar invite (until someone opens or enriches
    // it), or imported with research off (until someone enriches it).
    researchHeldAt: timestamp("research_held_at"),

    companyId: text("company_id").references(() => company.id, {
      onDelete: "set null",
    }),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "set null",
    }),

    source: text("source", { enum: RECORD_SOURCES })
      .notNull()
      .default("MANUAL"),

    lastActivityAt: timestamp("last_activity_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("contact_organization_email_active_uidx")
      .on(table.organizationId, table.email)
      .where(sql`${table.archivedAt} is null`),
    index("contact_organization_company_idx").on(
      table.organizationId,
      table.companyId,
    ),
    index("contact_organization_owner_idx").on(
      table.organizationId,
      table.ownerId,
    ),
    index("contact_organization_last_activity_idx").on(
      table.organizationId,
      table.lastActivityAt,
    ),
    index("contact_organization_archived_idx").on(
      table.organizationId,
      table.archivedAt,
    ),
    // The company list's count of each company's live contacts.
    index("contact_organization_company_archived_idx").on(
      table.organizationId,
      table.companyId,
      table.archivedAt,
    ),
    index("contact_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("contact_company_idx").on(table.companyId),
  ],
);

/**
 * One observation the agent made about a contact, priced by the evidence
 * ledger. Strong evidence is APPLIED to the record; weak evidence is PROPOSED
 * for a person to settle.
 */
export const contactFact = sqliteTable(
  "contact_fact",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: text("value").notNull(),
    score: real("score").notNull(),
    band: text("band", { enum: FACT_BANDS }).notNull(),
    evidence: text("evidence", { mode: "json" }).$type<unknown>().notNull(),
    method: text("method").notNull(),
    sourceUrl: text("source_url"),
    sessionId: text("session_id"),
    status: text("status", { enum: FACT_STATUSES })
      .notNull()
      .default("PROPOSED"),
    decidedById: text("decided_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    observedAt: timestamp("observed_at").notNull().default(isoNow),
    supersededAt: timestamp("superseded_at"),
  },
  (table) => [
    index("contact_fact_contact_field_status_idx").on(
      table.contactId,
      table.field,
      table.status,
    ),
    index("contact_fact_organization_status_observed_idx").on(
      table.organizationId,
      table.status,
      table.observedAt,
    ),
  ],
);

/** The agent's written brief on a contact. */
export const contactBrief = sqliteTable("contact_brief", {
  contactId: text("contact_id")
    .primaryKey()
    .references(() => contact.id, { onDelete: "cascade" }),
  organizationId: organizationId(),
  narrative: text("narrative").notNull(),
  sections: text("sections", { mode: "json" }).$type<unknown>().notNull(),
  score: real("score").notNull(),
  sourceUrl: text("source_url"),
  sessionId: text("session_id"),
  refreshedAt: timestamp("refreshed_at").notNull().default(isoNow),
});

export const deal = sqliteTable(
  "deal",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    description: text("description"),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    // Users are mirrors the gateway never deletes; restrict keeps a stray
    // delete from taking a deal's owner away.
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    stage: text("stage", { enum: DEAL_STAGES })
      .notNull()
      .default("DEMO_BOOKED"),
    stageChangedAt: timestamp("stage_changed_at").notNull().default(isoNow),
    // Money is a double, rounded to the currency's minor unit when written.
    amount: real("amount"),
    currency: text("currency").notNull().default("USD"),
    expectedCloseDate: timestamp("expected_close_date"),
    closedAt: timestamp("closed_at"),
    closedReason: text("closed_reason"),

    // The amount in the reporting currency, frozen when the deal is saved.
    baseAmount: real("base_amount"),
    baseCurrency: text("base_currency"),
    fxRate: real("fx_rate"),
    fxRateAt: timestamp("fx_rate_at"),

    source: text("source", { enum: RECORD_SOURCES })
      .notNull()
      .default("MANUAL"),

    lastActivityAt: timestamp("last_activity_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("deal_organization_company_idx").on(
      table.organizationId,
      table.companyId,
    ),
    index("deal_organization_owner_idx").on(
      table.organizationId,
      table.ownerId,
    ),
    index("deal_organization_stage_idx").on(table.organizationId, table.stage),
    index("deal_organization_expected_close_idx").on(
      table.organizationId,
      table.expectedCloseDate,
    ),
    index("deal_organization_last_activity_idx").on(
      table.organizationId,
      table.lastActivityAt,
    ),
    index("deal_organization_base_amount_idx").on(
      table.organizationId,
      table.baseAmount,
    ),
    index("deal_organization_currency_idx").on(
      table.organizationId,
      table.currency,
    ),
    index("deal_organization_archived_idx").on(
      table.organizationId,
      table.archivedAt,
    ),
    // The company list's count of each company's live open deals.
    index("deal_organization_company_archived_idx").on(
      table.organizationId,
      table.companyId,
      table.archivedAt,
    ),
    index("deal_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("deal_company_idx").on(table.companyId),
  ],
);

export const dealContact = sqliteTable(
  "deal_contact",
  {
    dealId: text("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    organizationId: organizationId(),
    role: text("role"),
  },
  (table) => [
    primaryKey({ columns: [table.dealId, table.contactId] }),
    index("deal_contact_contact_idx").on(table.contactId),
  ],
);

/**
 * Exchange rates fetched for every organization (base → quote). Reference
 * data, not an organization's: an organization's own overrides are
 * manual_fx_rate.
 */
export const fxRate = sqliteTable(
  "fx_rate",
  {
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: real("rate").notNull(),
    asOf: timestamp("as_of").notNull(),
    provider: text("provider"),
    // When the rates against this base are next fetched: when the feed
    // said it would publish new ones.
    nextFetchAt: timestamp("next_fetch_at"),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.baseCurrency, table.quoteCurrency] }),
  ],
);

/** A rate an organization set by hand, which wins over the fetched one. */
export const manualFxRate = sqliteTable(
  "manual_fx_rate",
  {
    organizationId: organizationId(),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: real("rate").notNull(),
    asOf: timestamp("as_of").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.baseCurrency, table.quoteCurrency],
    }),
  ],
);

/** A custom field an organization added to companies, contacts or deals. */
export const fieldDefinition = sqliteTable(
  "field_definition",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    entity: text("entity", { enum: FIELD_ENTITIES }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: FIELD_TYPES }).notNull(),
    agentFilled: integer("agent_filled", { mode: "boolean" })
      .notNull()
      .default(true),
    agentBrief: text("agent_brief"),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    showOnSheet: integer("show_on_sheet", { mode: "boolean" })
      .notNull()
      .default(true),
    showOnTable: integer("show_on_table", { mode: "boolean" })
      .notNull()
      .default(false),
    showOnFilter: integer("show_on_filter", { mode: "boolean" })
      .notNull()
      .default(false),
    position: integer("position").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("field_definition_organization_entity_key_uidx").on(
      table.organizationId,
      table.entity,
      table.key,
    ),
    index("field_definition_organization_entity_position_idx").on(
      table.organizationId,
      table.entity,
      table.position,
    ),
  ],
);

export const fieldOption = sqliteTable(
  "field_option",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    fieldId: text("field_id")
      .notNull()
      .references(() => fieldDefinition.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("field_option_field_position_idx").on(table.fieldId, table.position),
  ],
);

/** One custom field's value on one company, contact or deal. */
export const fieldValue = sqliteTable(
  "field_value",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    fieldId: text("field_id")
      .notNull()
      .references(() => fieldDefinition.id, { onDelete: "cascade" }),
    companyId: text("company_id").references(() => company.id, {
      onDelete: "cascade",
    }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "cascade",
    }),
    dealId: text("deal_id").references(() => deal.id, { onDelete: "cascade" }),
    text: text("text"),
    number: real("number"),
    date: timestamp("date"),
    bool: integer("bool", { mode: "boolean" }),
    optionId: text("option_id").references(() => fieldOption.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("field_value_field_company_uidx").on(
      table.fieldId,
      table.companyId,
    ),
    uniqueIndex("field_value_field_contact_uidx").on(
      table.fieldId,
      table.contactId,
    ),
    uniqueIndex("field_value_field_deal_uidx").on(table.fieldId, table.dealId),
    index("field_value_field_text_idx").on(table.fieldId, table.text),
    index("field_value_field_number_idx").on(table.fieldId, table.number),
    index("field_value_field_date_idx").on(table.fieldId, table.date),
    index("field_value_company_idx").on(table.companyId),
    index("field_value_contact_idx").on(table.contactId),
    index("field_value_deal_idx").on(table.dealId),
    index("field_value_option_idx").on(table.optionId),
    index("field_value_user_idx").on(table.userId),
  ],
);

/** A named list filter on companies, contacts or deals. */
export const savedView = sqliteTable(
  "saved_view",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    entity: text("entity", { enum: FIELD_ENTITIES }).notNull(),
    name: text("name").notNull(),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    filters: text("filters", { mode: "json" }).$type<unknown>().notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("saved_view_organization_entity_owner_name_uidx").on(
      table.organizationId,
      table.entity,
      table.ownerId,
      table.name,
    ),
    index("saved_view_organization_entity_shared_idx").on(
      table.organizationId,
      table.entity,
      table.shared,
    ),
  ],
);

/** A note, call, email, meeting, task or system event on the timeline. */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
    subject: text("subject"),
    body: text("body"),
    occurredAt: timestamp("occurred_at"),
    dueAt: timestamp("due_at"),
    completedAt: timestamp("completed_at"),
    companyId: text("company_id").references(() => company.id, {
      onDelete: "cascade",
    }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "cascade",
    }),
    dealId: text("deal_id").references(() => deal.id, { onDelete: "cascade" }),
    // Null when the research agent wrote it.
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    meta: text("meta", { mode: "json" }).$type<unknown>(),
    emailThreadId: text("email_thread_id").references(
      (): AnySQLiteColumn => emailThread.id,
      { onDelete: "cascade" },
    ),
    calendarEventId: text("calendar_event_id").references(
      (): AnySQLiteColumn => calendarEvent.id,
      { onDelete: "cascade" },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("activity_email_thread_uidx").on(table.emailThreadId),
    uniqueIndex("activity_calendar_event_uidx").on(table.calendarEventId),
    index("activity_organization_company_created_idx").on(
      table.organizationId,
      table.companyId,
      table.createdAt,
    ),
    index("activity_organization_deal_created_idx").on(
      table.organizationId,
      table.dealId,
      table.createdAt,
    ),
    index("activity_organization_contact_created_idx").on(
      table.organizationId,
      table.contactId,
      table.createdAt,
    ),
    index("activity_organization_due_idx").on(
      table.organizationId,
      table.dueAt,
    ),
    index("activity_created_by_idx").on(table.createdById),
    index("activity_company_idx").on(table.companyId),
    index("activity_contact_idx").on(table.contactId),
    index("activity_deal_idx").on(table.dealId),
  ],
);

/** A captured email conversation (src/server/features/mailbox). */
export const emailThread = sqliteTable(
  "email_thread",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    rootMessageId: text("root_message_id").notNull(),
    subject: text("subject"),
    companyId: text("company_id").references(() => company.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    firstMessageAt: timestamp("first_message_at").notNull(),
    lastMessageAt: timestamp("last_message_at").notNull(),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("email_thread_organization_root_uidx").on(
      table.organizationId,
      table.rootMessageId,
    ),
    index("email_thread_organization_company_last_idx").on(
      table.organizationId,
      table.companyId,
      table.lastMessageAt,
    ),
    index("email_thread_organization_contact_last_idx").on(
      table.organizationId,
      table.contactId,
      table.lastMessageAt,
    ),
    index("email_thread_company_idx").on(table.companyId),
    index("email_thread_contact_idx").on(table.contactId),
  ],
);

export const emailMessage = sqliteTable(
  "email_message",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThread.id, { onDelete: "cascade" }),
    rfcMessageId: text("rfc_message_id").notNull(),
    syncedByUserId: text("synced_by_user_id"),
    direction: text("direction", { enum: EMAIL_DIRECTIONS }).notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    recipients: text("recipients", { mode: "json" }).$type<unknown>().notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    body: text("body"),
    sentAt: timestamp("sent_at").notNull(),
    // Where the message lives in the mailbox it was captured from, for "Open
    // in Gmail" and "Open in Outlook".
    gmailMessageId: text("gmail_message_id"),
    outlookMessageId: text("outlook_message_id"),
    outlookWebLink: text("outlook_web_link"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("email_message_organization_rfc_uidx").on(
      table.organizationId,
      table.rfcMessageId,
    ),
    index("email_message_thread_sent_idx").on(table.threadId, table.sentAt),
    index("email_message_organization_gmail_idx").on(
      table.organizationId,
      table.gmailMessageId,
    ),
    index("email_message_organization_synced_by_idx").on(
      table.organizationId,
      table.syncedByUserId,
    ),
  ],
);

/** A captured meeting (src/server/features/mailbox). */
export const calendarEvent = sqliteTable(
  "calendar_event",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    iCalUid: text("ical_uid").notNull(),
    originalStartTime: timestamp("original_start_time").notNull(),
    recurringEventId: text("recurring_event_id"),
    title: text("title"),
    description: text("description"),
    location: text("location"),
    conferenceUrl: text("conference_url"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    isAllDay: integer("is_all_day", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status").notNull(),
    organizerEmail: text("organizer_email"),
    companyId: text("company_id").references(() => company.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    syncedByUserId: text("synced_by_user_id"),
    googleEventId: text("google_event_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("calendar_event_organization_synced_by_idx").on(
      table.organizationId,
      table.syncedByUserId,
    ),
    uniqueIndex("calendar_event_organization_ical_start_uidx").on(
      table.organizationId,
      table.iCalUid,
      table.originalStartTime,
    ),
    index("calendar_event_organization_company_starts_idx").on(
      table.organizationId,
      table.companyId,
      table.startsAt,
    ),
    index("calendar_event_organization_contact_starts_idx").on(
      table.organizationId,
      table.contactId,
      table.startsAt,
    ),
    index("calendar_event_company_idx").on(table.companyId),
    index("calendar_event_contact_idx").on(table.contactId),
  ],
);

export const calendarAttendee = sqliteTable(
  "calendar_attendee",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    eventId: text("event_id")
      .notNull()
      .references(() => calendarEvent.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    responseStatus: text("response_status"),
    isOrganizer: integer("is_organizer", { mode: "boolean" })
      .notNull()
      .default(false),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("calendar_attendee_event_email_uidx").on(
      table.eventId,
      table.email,
    ),
    index("calendar_attendee_contact_idx").on(table.contactId),
  ],
);

/** A domain whose people never become contacts on their own. */
export const suppressedDomain = sqliteTable(
  "suppressed_domain",
  {
    organizationId: organizationId(),
    domain: text("domain").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.domain] })],
);

/** An address that never becomes a contact on its own. */
export const suppressedContact = sqliteTable(
  "suppressed_contact",
  {
    organizationId: organizationId(),
    email: text("email").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.email] })],
);

/**
 * A member's own mailbox and calendar connection (Google or Microsoft): the
 * account it reads, the scopes granted, and the member's tokens, which never
 * leave the server. The gateway holds the OAuth client; the CRM keeps the
 * tokens, as the CRM's Better Auth `account` row did.
 */
export const mailboxConnection = sqliteTable(
  "mailbox_connection",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: MAILBOX_PROVIDERS }).notNull(),
    // Lowercased: the address the member's mail is sent from.
    accountEmail: text("account_email").notNull(),
    // Space-separated, as the provider granted them.
    scopes: text("scopes").notNull(),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshToken: text("refresh_token"),
    status: text("status", { enum: CONNECTION_STATUSES })
      .notNull()
      .default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("mailbox_connection_organization_user_provider_uidx").on(
      table.organizationId,
      table.userId,
      table.provider,
    ),
  ],
);

/**
 * A pending connect: the single-use `state` sent to the provider's authorize
 * page, bound to the member and organization, with its PKCE verifier. The
 * callback consumes it with a conditional update.
 */
export const oauthState = sqliteTable(
  "oauth_state",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: MAILBOX_PROVIDERS }).notNull(),
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [index("oauth_state_expires_idx").on(table.expiresAt)],
);

/**
 * One member's sync of one source (calendar, gmail, outlook): its cursor,
 * whether it may add companies and contacts, when it runs next, and the
 * lease a running check holds.
 */
export const mailboxSync = sqliteTable(
  "mailbox_sync",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source", { enum: SYNC_SOURCES }).notNull(),
    status: text("status", { enum: SYNC_STATUSES }).notNull().default("IDLE"),
    cursor: text("cursor"),
    autoCreate: integer("auto_create", { mode: "boolean" })
      .notNull()
      .default(false),
    lastSyncedAt: timestamp("last_synced_at"),
    lastError: text("last_error"),
    // Null while the member must reconnect: nothing schedules it.
    nextSyncAt: timestamp("next_sync_at"),
    leaseUntil: timestamp("lease_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("mailbox_sync_organization_user_source_uidx").on(
      table.organizationId,
      table.userId,
      table.source,
    ),
    // The minute cron's one query across every organization.
    index("mailbox_sync_next_idx").on(table.nextSyncAt),
  ],
);
