// Postgres mirror of ../tracking.schema.ts; schema-parity.test.ts keeps the
// two structurally identical.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { DOMAIN_SCOPES } from "../../shared/tracking";
import { organization } from "./auth.schema";
import { isoNow, timestamp } from "./columns";
import { contact } from "./crm.schema";

// Website tracking (docs/maintainers/website-tracking.md): the snippet an
// organization puts on its own website, the page views and clicks it sends,
// and the form submissions that become contacts. The collector is the CRM's
// one anonymous write path; the organization of everything it writes comes
// from the site id alone.

const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/** An organization's tracking settings, and the site id its snippet carries. */
export const trackingSite = pgTable(
  "tracking_site",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Minted once an allowed domain makes tracking ready; rotating it is the
    // kill switch for a stolen snippet.
    siteId: text("site_id"),
    crossDomain: boolean("cross_domain").notNull().default(true),
    limitToDomains: boolean("limit_to_domains").notNull().default(true),
    cookieSubdomains: boolean("cookie_subdomains").notNull().default(false),
    secureCookies: boolean("secure_cookies").notNull().default(true),
    honourDnt: boolean("honour_dnt").notNull().default(true),
    cookieDays: integer("cookie_days").notNull().default(395),
    paused: boolean("paused").notNull().default(false),
    createdAt: timestamp("created_at").notNull().default(isoNow),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
  },
  (table) => [uniqueIndex("tracking_site_site_id_uidx").on(table.siteId)],
);

/** A host the snippet may record on. */
export const trackedDomain = pgTable(
  "tracked_domain",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    host: text("host").notNull(),
    scope: text("scope", { enum: DOMAIN_SCOPES })
      .notNull()
      .default("EXACT_HOST"),
    pageViews: integer("page_views").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("tracked_domain_organization_host_uidx").on(
      table.organizationId,
      table.host,
    ),
  ],
);

/**
 * A browser the snippet recognised, once a form submission tied it to a
 * contact, with its first and last touch. The id is the visitor cookie,
 * minted by the browser, so it is only unique within an organization.
 */
export const trackedVisitor = pgTable(
  "tracked_visitor",
  {
    organizationId: organizationId(),
    id: text("id").notNull(),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    firstSource: text("first_source"),
    firstMedium: text("first_medium"),
    firstCampaign: text("first_campaign"),
    firstTerm: text("first_term"),
    firstContent: text("first_content"),
    firstReferrer: text("first_referrer"),
    firstLanding: text("first_landing"),
    firstTouchAt: timestamp("first_touch_at"),
    lastSource: text("last_source"),
    lastMedium: text("last_medium"),
    lastCampaign: text("last_campaign"),
    lastTerm: text("last_term"),
    lastContent: text("last_content"),
    lastReferrer: text("last_referrer"),
    lastLanding: text("last_landing"),
    lastTouchAt: timestamp("last_touch_at"),
    firstSeen: timestamp("first_seen").notNull().default(isoNow),
    lastSeen: timestamp("last_seen").notNull().default(isoNow),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("tracked_visitor_organization_contact_idx").on(
      table.organizationId,
      table.contactId,
    ),
  ],
);

/** A page view or a click; kept for the retention window, then rolled up. */
export const trackedEvent = pgTable(
  "tracked_event",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    visitorId: text("visitor_id").notNull(),
    type: text("type").notNull(),
    host: text("host").notNull(),
    path: text("path").notNull(),
    referrer: text("referrer"),
    label: text("label"),
    source: text("source"),
    medium: text("medium"),
    campaign: text("campaign"),
    occurredAt: timestamp("occurred_at").notNull(),
  },
  (table) => [
    index("tracked_event_organization_visitor_occurred_idx").on(
      table.organizationId,
      table.visitorId,
      table.occurredAt,
    ),
    index("tracked_event_organization_host_occurred_idx").on(
      table.organizationId,
      table.host,
      table.occurredAt,
    ),
    index("tracked_event_organization_source_idx").on(
      table.organizationId,
      table.source,
      table.medium,
    ),
    // Retention sweeps every organization by age.
    index("tracked_event_occurred_idx").on(table.occurredAt),
  ],
);

/**
 * Page views per page per UTC day (`YYYY-MM-DD`), rolled up from events
 * before retention deletes them.
 */
export const trackedPageDaily = pgTable(
  "tracked_page_daily",
  {
    organizationId: organizationId(),
    day: text("day").notNull(),
    host: text("host").notNull(),
    path: text("path").notNull(),
    views: integer("views").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.day, table.host, table.path],
    }),
  ],
);

/**
 * A fixed-window counter (`<what>:<window>`) the collector charges
 * atomically: events per site and per visitor each minute, new contacts
 * each hour.
 */
export const trackingCounter = pgTable(
  "tracking_counter",
  {
    organizationId: organizationId(),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.key] }),
    index("tracking_counter_expires_idx").on(table.expiresAt),
  ],
);

/**
 * A form submitted on the website. Every one is kept; filing it as a
 * contact is separate and may decline (`skipReason`).
 */
export const formSubmission = pgTable(
  "form_submission",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    visitorId: text("visitor_id"),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    host: text("host").notNull(),
    path: text("path").notNull(),
    email: text("email"),
    fields: jsonb("fields").$type<unknown>().notNull(),
    firstTouch: jsonb("first_touch").$type<unknown>(),
    lastTouch: jsonb("last_touch").$type<unknown>(),
    // Collapses a resend of one submission within a minute.
    dedupeKey: text("dedupe_key").notNull(),
    filedAt: timestamp("filed_at"),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("form_submission_organization_dedupe_uidx").on(
      table.organizationId,
      table.dedupeKey,
    ),
    index("form_submission_organization_contact_idx").on(
      table.organizationId,
      table.contactId,
    ),
  ],
);
