import type { DomainScope } from "@/shared/tracking";

// Every constant and pure rule the tracker, the collector and the settings
// share. The tracker's source interpolates these, so the browser and the
// server cannot disagree about a limit.

const SITE_ID_PREFIX = "cmp_";
/** The visitor cookie, and the first-touch cookie beside it. */
export const COOKIE_NAME = "_crm_v";
export const COOKIE_FIRST_TOUCH = "_crm_fs";

/** The collector's bounds: what one POST may carry. */
export const MAX_EVENTS_PER_BATCH = 20;
// A form is forty fields of 512 characters; under that, the submission this
// feature exists for is silently dropped.
export const MAX_BODY_BYTES = 32_768;
export const MAX_FORM_FIELDS = 40;

/** Events a site may record per minute, and one visitor of it. */
export const SITE_EVENTS_PER_MINUTE = 600;
export const VISITOR_EVENTS_PER_MINUTE = 120;
/** Events an organization may record per UTC day, whatever the minute's rate. */
export const ORG_EVENTS_PER_DAY = 50_000;
/**
 * Requests one address may make to the public routes per minute, to one
 * site and in all, counted before anything reads the database.
 */
export const ADDRESS_SITE_REQUESTS_PER_MINUTE = 120;
export const ADDRESS_REQUESTS_PER_MINUTE = 600;
/** New contacts form submissions may create per organization per hour. */
export const CONTACTS_PER_HOUR = 50;

/** `/t/crm.js` never changes: a browser keeps it ten minutes, the edge a year. */
export const LOADER_MAX_AGE_SECONDS = 600;
export const BUNDLE_MAX_AGE_SECONDS = 31_536_000;
// Pausing or rotating stops every browser within this. No
// stale-while-revalidate: that is a licence to run the old config after a
// pause.
export const CONFIG_MAX_AGE_SECONDS = 300;

export const EVENT_RETENTION_DAYS = 90;

/** A cross-domain link carries the visitor for this long. */
export const LINKER_MAX_AGE_SECONDS = 120;

/** Verify: how recent a page view proves the install, and what it reads. */
export const VERIFY_WINDOW_MS = 5 * 60_000;
export const MAX_VERIFY_BYTES = 2_000_000;
const MAX_CONTAINERS = 2;

type GtmTagState = "absent" | "url" | "attribute";

export interface TrackedHost {
  host: string;
  scope: DomainScope;
}

/** What the tracker is compiled with; nothing in it is secret. */
export interface TrackingConfig {
  siteId: string;
  crossDomain: boolean;
  limitToDomains: boolean;
  cookieSubdomains: boolean;
  secureCookies: boolean;
  honourDnt: boolean;
  cookieDays: number;
  hosts: TrackedHost[];
}

/** A site's settings row and its allowed domains, as the tracker takes them. */
export function trackingConfig(
  site: Omit<TrackingConfig, "siteId" | "hosts">,
  siteId: string,
  domains: readonly TrackedHost[],
): TrackingConfig {
  return {
    siteId,
    crossDomain: site.crossDomain,
    limitToDomains: site.limitToDomains,
    cookieSubdomains: site.cookieSubdomains,
    secureCookies: site.secureCookies,
    honourDnt: site.honourDnt,
    cookieDays: site.cookieDays,
    hosts: domains.map(({ host, scope }) => ({ host, scope })),
  };
}

// 64 random bits: the site id is the only thing that names an organization
// on the public routes, so it must not be enumerable.
const SITE_ID_SHAPE = /^cmp_[0-9a-f]{16}$/;

export function mintSiteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${SITE_ID_PREFIX}${hex}`;
}

export function isSiteId(value: unknown): value is string {
  return typeof value === "string" && SITE_ID_SHAPE.test(value);
}

/** Tracking has somewhere to run: no allow-list, or a domain on it. */
export function trackingReady(
  limitToDomains: boolean,
  domainCount: number,
): boolean {
  return !limitToDomains || domainCount > 0;
}

function loaderUrl(appOrigin: string): string {
  return `${appOrigin.replace(/\/+$/, "")}/t/crm.js`;
}

export function trackingSnippet(appOrigin: string, siteId: string): string {
  return `<script src="${loaderUrl(appOrigin)}" data-site="${siteId}" async defer></script>`;
}

// Tag Manager's Custom HTML injector keeps only a script's URL, so the
// snippet for it carries the site id there.
export function gtmSnippet(appOrigin: string, siteId: string): string {
  return `<script src="${loaderUrl(appOrigin)}?site=${siteId}" async defer></script>`;
}

/** Built from an id matched in the page, never from what a person typed. */
export function gtmContainerUrl(container: string): string {
  return `https://www.googletagmanager.com/gtm.js?id=${container}`;
}

export function gtmContainers(html: string): string[] {
  const found = html.match(/GTM-[A-Z0-9]{4,10}/g) ?? [];
  return [...new Set(found)].slice(0, MAX_CONTAINERS);
}

/** Whether a container carries the tag, and in the form that survives it. */
export function gtmTag(source: string, siteId: string): GtmTagState {
  const text = source.replace(/\\\//g, "/");
  if (!text.includes("/t/crm.js")) return "absent";
  if (text.includes(`/t/crm.js?site=${siteId}`)) return "url";
  return text.includes(siteId) ? "attribute" : "absent";
}

/** A bare lowercase hostname with a dot in it, or null. */
export function normalizeHost(input: string | null | undefined): string | null {
  const trimmed = input?.trim().toLowerCase();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  const bare = host.replace(/\.$/, "");
  if (!bare.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(bare)) return null;
  if (bare.startsWith(".") || bare.includes("..")) return null;
  return bare;
}

/** A path without its query or fragment, which can carry secrets. */
export function normalizePath(input: string | null | undefined): string {
  const raw = input?.trim();
  if (!raw) return "/";
  const path = raw.split(/[?#]/)[0] ?? "/";
  if (!path.startsWith("/")) return "/";
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return trimmed === "" ? "/" : trimmed;
}

/** A URL without its query or fragment (a reset link stays out of storage). */
export function stripQuery(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const cut = raw.split(/[?#]/)[0] ?? "";
  return cut === "" ? null : cut;
}

export function matchedHost(
  host: string,
  config: Pick<TrackingConfig, "hosts">,
): TrackedHost | null {
  const candidate = host.toLowerCase();
  const exact = config.hosts.find((entry) => candidate === entry.host);
  if (exact) return exact;
  return (
    config.hosts.find(
      (entry) =>
        entry.scope === "SITE_AND_SUBDOMAINS" &&
        candidate.endsWith(`.${entry.host}`),
    ) ?? null
  );
}

export function hostAllowed(host: string, config: TrackingConfig): boolean {
  if (!config.limitToDomains) return true;
  return matchedHost(host, config) !== null;
}

/**
 * The page the POST came from may record. A missing Origin is refused even
 * with the allow-list off: it is what ties the POST to a browser on a page.
 */
export function originAllowed(
  origin: string | null,
  config: TrackingConfig,
): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostAllowed(host, config);
}

/** One minute's window, one hour's and one day's: the counters' keys. */
export function minuteWindow(at: Date): { key: string; expiresAt: string } {
  const minute = Math.floor(at.getTime() / 60_000);
  return {
    key: String(minute),
    expiresAt: new Date((minute + 2) * 60_000).toISOString(),
  };
}

export function hourWindow(at: Date): { key: string; expiresAt: string } {
  const hour = Math.floor(at.getTime() / 3_600_000);
  return {
    key: String(hour),
    expiresAt: new Date((hour + 2) * 3_600_000).toISOString(),
  };
}

export function dayWindow(at: Date): { key: string; expiresAt: string } {
  const day = Math.floor(at.getTime() / 86_400_000);
  return {
    key: String(day),
    expiresAt: new Date((day + 2) * 86_400_000).toISOString(),
  };
}

/** Collapses a resend of one submission within a minute. */
export async function dedupeKey(parts: {
  host: string;
  path: string;
  email: string | null;
  at: Date;
}): Promise<string> {
  const minute = Math.floor(parts.at.getTime() / 60_000);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${parts.host}|${parts.path}|${parts.email ?? ""}|${minute}`,
    ),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The UTC midnight `days` before `now`: retention rolls whole days only. */
export function retentionCutoff(now: Date, days: number): string {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff.toISOString();
}
