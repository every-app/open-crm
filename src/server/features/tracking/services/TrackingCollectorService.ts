import { env } from "cloudflare:workers";
import { z } from "zod";
import { forOrganization } from "@/server/lib/gateway-attribution";
import { withinAddressLimit } from "@/server/features/tracking/addressLimit";
import {
  classifyTouch,
  type RawTouch,
  type Touch,
} from "@/server/features/tracking/attribution";
import {
  TrackingEventRepository,
  type TouchColumns,
} from "@/server/features/tracking/repositories/TrackingEventRepository";
import { TrackingSiteRepository } from "@/server/features/tracking/repositories/TrackingSiteRepository";
import { TrackingFilingService } from "@/server/features/tracking/services/TrackingFilingService";
import {
  dayWindow,
  dedupeKey,
  hostAllowed,
  isSiteId,
  MAX_EVENTS_PER_BATCH,
  MAX_FORM_FIELDS,
  matchedHost,
  minuteWindow,
  normalizePath,
  ORG_EVENTS_PER_DAY,
  originAllowed,
  SENSITIVE_FIELD,
  SITE_EVENTS_PER_MINUTE,
  stripQuery,
  trackingConfig,
  type TrackingConfig,
  VISITOR_EVENTS_PER_MINUTE,
} from "@/server/features/tracking/trackingRules";
import { normalizeEmail } from "@/shared/domain";
import {
  trackedEventSchema,
  trackingBatchSchema,
  type TrackedEventInput,
} from "@/types/schemas/tracking";

// The public side of website tracking: the config a site's tracker is built
// with, and the collector its POSTs land in. Nothing on these requests says
// who they are for except the site id, so the organization comes from the
// site id alone, and everything is bounded before it costs a write.
//
// The collector's checks, in order (each refusal is silent; the route always
// answers 204, so a stranger learns nothing by probing it):
//
// 1. a bot's user agent;
// 2. the site id: shaped like one, live (a rotated id names nothing), not
//    paused, and the pinned organization's (EVERY_APP_ORG_ID);
// 3. Origin: present, and on the allow-list when there is one;
// 4. the visitor id: 8 to 64 of [A-Za-z0-9_-];
// 5. replay: three or more events sharing one timestamp;
// 6. the address's requests this minute, to the site and in all, counted
//    in memory (addressLimit.ts);
// 7. each event's host against the allow-list (the batch is filtered, not
//    refused);
// 8. the rate, charged per accepted event in the database: per organization
//    a day, then per site and per visitor a minute; a refused charge spends
//    nothing.
//
// The cheap checks (1, the id's shape, Origin's presence, 4, 5, 6) run
// before the one database lookup.

const MAX_LABEL = 80;
const MAX_PATH = 512;
const MAX_HOST = 253;
const MAX_FIELD_KEY = 64;
const MAX_FIELD_VALUE = 512;

const BOT = /bot|crawler|spider|crawling|headlesschrome|lighthouse|preview/i;
// Values shaped like a card never leave the collector either.
const CARD = /^[0-9 -]{12,25}$/;

type Site = { organizationId: string; config: TrackingConfig };

/**
 * The live config a site id names, or null: unknown, rotated away, paused,
 * or not the pinned organization's (EVERY_APP_ORG_ID).
 */
async function configForSite(siteId: string): Promise<Site | null> {
  if (!isSiteId(siteId)) return null;
  const site = await TrackingSiteRepository.findBySiteId(siteId);
  if (!site?.siteId || site.paused) return null;
  const pinned = env.EVERY_APP_ORG_ID;
  if (pinned && site.organizationId !== pinned) return null;
  const domains = await TrackingSiteRepository.listDomains(site.organizationId);
  return {
    organizationId: site.organizationId,
    config: trackingConfig(site, site.siteId, domains),
  };
}

function trim(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function visitorIdOf(value: string): string | null {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * A replayed or scripted batch: three or more events with one timestamp.
 * Only when every event carries one; a missing timestamp is no signal.
 */
function scripted(events: TrackedEventInput[]): boolean {
  if (events.length < 3) return false;
  const stamps = events.flatMap((event) =>
    event.at === undefined ? [] : [event.at],
  );
  if (stamps.length !== events.length) return false;
  return new Set(stamps).size === 1;
}

/** When it happened, as the browser says, but never ahead or a day back. */
function occurredAt(at: number | undefined): Date {
  const now = Date.now();
  if (at === undefined) return new Date(now);
  return new Date(Math.min(Math.max(at, now - 86_400_000), now));
}

function arriving(touch: RawTouch | undefined): RawTouch {
  return {
    ...touch,
    referrer: stripQuery(touch?.referrer) ?? undefined,
    landing: stripQuery(touch?.landing) ?? undefined,
  };
}

function stored(touch: Touch): TouchColumns {
  return {
    source: touch.source,
    medium: touch.medium,
    campaign: touch.campaign,
    term: touch.term,
    content: touch.content,
    referrer: touch.referrer,
    landing: touch.landing,
    at: touch.at.toISOString(),
  };
}

/** Text fields only, never a sensitive one or a card number. */
function cleanFields(fields: Record<string, unknown> | undefined) {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields ?? {}).slice(
    0,
    MAX_FORM_FIELDS,
  )) {
    if (typeof value !== "string") continue;
    if (SENSITIVE_FIELD.test(key)) continue;
    if (CARD.test(value.trim())) continue;
    kept[trim(key, MAX_FIELD_KEY)] = trim(value, MAX_FIELD_VALUE);
  }
  return kept;
}

function emailFrom(fields: Record<string, string>): string | null {
  const entries = Object.entries(fields);
  const labelled = entries.filter(([key]) => /mail/i.test(key));
  for (const [, value] of [...labelled, ...entries]) {
    const email = normalizeEmail(value);
    if (email) return email;
  }
  return null;
}

function pick(fields: Record<string, string>, pattern: RegExp): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (pattern.test(key) && value.trim()) return value.trim();
  }
  return null;
}

function nameFrom(fields: Record<string, string>): string | null {
  const first = pick(fields, /^(first[\s_-]?name|fname|given)/i);
  const last = pick(fields, /^(last[\s_-]?name|lname|surname|family)/i);
  if (first) return last ? `${first} ${last}` : first;
  return pick(fields, /^(full[\s_-]?name|name)$/i) ?? pick(fields, /name/i);
}

type Accepted = { event: TrackedEventInput; host: string };

/**
 * Charges the batch to the organization's day, the site's minute, then the
 * visitor's; a refused charge hands back the ones before it.
 */
async function withinRate(
  organizationId: string,
  visitorId: string,
  events: number,
): Promise<boolean> {
  const now = new Date();
  const minute = minuteWindow(now);
  const day = dayWindow(now);
  const charges = [
    { key: `day:${day.key}`, limit: ORG_EVENTS_PER_DAY, window: day },
    {
      key: `site:${minute.key}`,
      limit: SITE_EVENTS_PER_MINUTE,
      window: minute,
    },
    {
      key: `visitor:${visitorId}:${minute.key}`,
      limit: VISITOR_EVENTS_PER_MINUTE,
      window: minute,
    },
  ];
  const taken: string[] = [];
  for (const { key, limit, window } of charges) {
    if (
      !(await TrackingEventRepository.take(
        organizationId,
        key,
        limit,
        events,
        window.expiresAt,
      ))
    ) {
      for (const charged of taken) {
        await TrackingEventRepository.release(organizationId, charged, events);
      }
      return false;
    }
    taken.push(key);
  }
  return true;
}

async function recordEvents(
  site: Site,
  visitorId: string,
  accepted: Accepted[],
) {
  const rows = accepted.map(({ event, host }) => {
    const touch =
      event.type === "page_view" && event.touch
        ? classifyTouch(arriving(event.touch))
        : null;
    const referrer = stripQuery(event.referrer);
    return {
      organizationId: site.organizationId,
      visitorId,
      type: event.type,
      host,
      path: trim(normalizePath(event.path), MAX_PATH),
      referrer: referrer ? trim(referrer, MAX_PATH) : null,
      label: event.label ? trim(event.label.trim(), MAX_LABEL) || null : null,
      source: touch?.source ?? null,
      medium: touch?.medium ?? null,
      campaign: touch?.campaign ?? null,
      occurredAt: occurredAt(event.at).toISOString(),
    };
  });
  await TrackingEventRepository.insertEvents(rows);

  // Page views per allowed domain, for the settings' domain list.
  const tallies = new Map<string, number>();
  for (const row of rows) {
    const entry = matchedHost(row.host, site.config);
    if (!entry) continue;
    tallies.set(
      entry.host,
      (tallies.get(entry.host) ?? 0) + (row.type === "page_view" ? 1 : 0),
    );
  }
  const seenAt = new Date().toISOString();
  for (const [host, views] of tallies) {
    await TrackingSiteRepository.recordDomainViews(
      site.organizationId,
      host,
      views,
      seenAt,
    );
  }
}

async function recordSubmission(
  organizationId: string,
  visitorId: string,
  { event, host }: Accepted,
) {
  const fields = cleanFields(event.fields);
  const email = emailFrom(fields);
  const path = trim(normalizePath(event.path), MAX_PATH);
  const at = occurredAt(event.at);
  const lastTouch = classifyTouch(arriving(event.touch), at);
  const firstTouch = event.firstTouch
    ? classifyTouch(arriving(event.firstTouch), at)
    : lastTouch;
  // A deleted person's address, or a suppressed domain, is never filed
  // (TrackingFilingService), and nothing it sent is kept.
  const suppressed = email
    ? await TrackingEventRepository.suppression(
        organizationId,
        email,
        email.slice(email.lastIndexOf("@") + 1),
      )
    : null;
  const forget = Boolean(suppressed?.address || suppressed?.domain);

  const submission = await TrackingEventRepository.insertSubmission({
    organizationId,
    visitorId,
    host,
    path,
    email: forget ? null : email,
    fields: forget ? {} : fields,
    firstTouch: stored(firstTouch),
    lastTouch: stored(lastTouch),
    dedupeKey: await dedupeKey({ host, path, email, at }),
  });
  if (!submission) return;
  // A resend within the minute is a retry only if the first attempt died
  // before it filed or declined.
  const settled = submission.filedAt !== null || submission.skipReason !== null;
  if (!submission.created && settled) return;

  const outcome = await TrackingFilingService.file(organizationId, {
    id: submission.id,
    email,
    name: nameFrom(fields),
    host,
    path,
    visitorId,
    firstTouch: stored(firstTouch),
    lastTouch: stored(lastTouch),
  });
  if (!outcome.filed) {
    console.log("[tracking] form submission stored, not filed", {
      organizationId,
      host,
      reason: outcome.reason,
    });
  }
}

const bodySchema = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Not JSON" });
      return z.NEVER;
    }
  })
  .pipe(trackingBatchSchema);

/** Takes one POST from a tracker; never throws for anything it was sent. */
async function accept(
  body: string,
  request: {
    origin: string | null;
    userAgent: string | null;
    /** The client's address (addressLimit.ts), when the request names one. */
    address?: string;
  },
): Promise<void> {
  if (request.userAgent && BOT.test(request.userAgent)) return;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return;
  const batch = parsed.data;
  if (!isSiteId(batch.siteId) || !request.origin) return;
  const visitorId = visitorIdOf(batch.visitorId);
  if (!visitorId) return;
  const events = batch.events.slice(0, MAX_EVENTS_PER_BATCH).flatMap((raw) => {
    const event = trackedEventSchema.safeParse(raw);
    return event.success ? [event.data] : [];
  });
  if (events.length === 0 || scripted(events)) return;
  if (!withinAddressLimit(request.address ?? "", batch.siteId)) return;

  const site = await configForSite(batch.siteId);
  if (!site || !originAllowed(request.origin, site.config)) return;

  const accepted = events.flatMap((event) => {
    const host = trim(event.host.toLowerCase(), MAX_HOST);
    return hostAllowed(host, site.config) ? [{ event, host }] : [];
  });
  if (accepted.length === 0) return;

  // Everything below is the organization's work, as background work is.
  await forOrganization(site.organizationId, async () => {
    if (!(await withinRate(site.organizationId, visitorId, accepted.length))) {
      return;
    }
    const views = accepted.filter(({ event }) => event.type !== "form_submit");
    if (views.length > 0) await recordEvents(site, visitorId, views);
    for (const form of accepted) {
      if (form.event.type === "form_submit") {
        await recordSubmission(site.organizationId, visitorId, form);
      }
    }
  });
}

export const TrackingCollectorService = { configForSite, accept };
