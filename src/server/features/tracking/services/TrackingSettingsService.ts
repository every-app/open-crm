import { AppError } from "@/server/lib/errors";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { WebsiteActivityRepository } from "@/server/features/tracking/repositories/WebsiteActivityRepository";
import { TrackingSiteRepository } from "@/server/features/tracking/repositories/TrackingSiteRepository";
import {
  gtmContainers,
  gtmContainerUrl,
  gtmSnippet,
  gtmTag,
  hostAllowed,
  loaderUrl,
  MAX_VERIFY_BYTES,
  mintSiteId,
  normalizeHost,
  trackingConfig,
  trackingReady,
  trackingSnippet,
  VERIFY_WINDOW_MS,
} from "@/server/features/tracking/trackingRules";
import { COOKIE_LIFETIMES, type TrackingFlag } from "@/shared/tracking";
import type { AddTrackedDomainInput } from "@/types/schemas/tracking";

// Settings → Tracking (owners and admins; the server functions gate it):
// the snippet, the allowed domains, the switches baked into the tracker, the
// site id's rotation, "verify installation", and traffic sources. Every
// change reaches browsers within the tracker's five-minute cache.

async function siteWithDomains(organizationId: string) {
  const [site, domains] = await Promise.all([
    TrackingSiteRepository.getOrCreate(organizationId),
    TrackingSiteRepository.listDomains(organizationId),
  ]);
  return { site, domains };
}

/**
 * The settings, with the snippet once tracking is ready (an allowed domain,
 * or the allow-list off): the site id is minted then, not before.
 */
async function getSettings(organizationId: string, appOrigin: string) {
  let { site, domains } = await siteWithDomains(organizationId);
  const ready = trackingReady(site.limitToDomains, domains.length);
  if (ready && !site.siteId) {
    await TrackingSiteRepository.setSiteIdIfMissing(
      organizationId,
      mintSiteId(),
    );
    ({ site, domains } = await siteWithDomains(organizationId));
  }
  const totals = await WebsiteActivityRepository.totals(organizationId);
  const siteId = site.siteId;
  return {
    siteId,
    ready,
    scriptUrl: loaderUrl(appOrigin),
    snippet: siteId ? trackingSnippet(appOrigin, siteId) : null,
    tagManagerSnippet: siteId ? gtmSnippet(appOrigin, siteId) : null,
    crossDomain: site.crossDomain,
    limitToDomains: site.limitToDomains,
    cookieSubdomains: site.cookieSubdomains,
    secureCookies: site.secureCookies,
    honourDnt: site.honourDnt,
    cookieDays: site.cookieDays,
    paused: site.paused,
    cookieLifetimes: [...COOKIE_LIFETIMES],
    domains,
    ...totals,
  };
}

async function setFlag(
  organizationId: string,
  flag: TrackingFlag,
  enabled: boolean,
) {
  await TrackingSiteRepository.setFlag(organizationId, flag, enabled);
  console.log("[tracking] setting changed", { organizationId, flag, enabled });
}

async function setCookieDays(organizationId: string, days: number) {
  await TrackingSiteRepository.setCookieDays(organizationId, days);
}

async function addDomain(organizationId: string, input: AddTrackedDomainInput) {
  const host = normalizeHost(input.host);
  if (!host) {
    throw new AppError("VALIDATION_ERROR", `Not a domain: ${input.host}`);
  }
  try {
    const id = await TrackingSiteRepository.addDomain(
      organizationId,
      host,
      input.scope,
    );
    return { id, host };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", `${host} is already on the list.`);
    }
    throw error;
  }
}

async function removeDomain(organizationId: string, id: string) {
  if (!(await TrackingSiteRepository.removeDomain(organizationId, id))) {
    throw new AppError("NOT_FOUND", `No tracked domain with id ${id}.`);
  }
}

/**
 * The kill switch for a stolen snippet: the old id stops naming the
 * organization at once (and its tracker within its cache's five minutes).
 */
async function rotateSiteId(organizationId: string) {
  const siteId = mintSiteId();
  await TrackingSiteRepository.replaceSiteId(organizationId, siteId);
  console.warn("[tracking] site id rotated", { organizationId });
  return { siteId };
}

async function sources(organizationId: string) {
  return WebsiteActivityRepository.sources(organizationId);
}

// Verify installation fetches a page the person names, from the Worker:
// https on every hop, no credentials, redirects followed by hand (each hop
// checked again; global_fetch_strictly_public keeps them all off private
// addresses), a timeout, and only the first MAX_VERIFY_BYTES read.
const VERIFY_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

type Fetched = { status: number; url: URL; text: string | null };

async function readPrefix(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (size < MAX_VERIFY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = MAX_VERIFY_BYTES - size;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      size += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

async function fetchPage(url: URL): Promise<Fetched | null> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (target.protocol !== "https:" || target.username || target.password) {
      return null;
    }
    let response: Response;
    try {
      response = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        headers: {
          accept: "text/html,application/javascript,*/*",
          "user-agent": "Mozilla/5.0 (compatible; OpenCRM/1.0; +verify)",
        },
      });
    } catch {
      return null;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      try {
        target = new URL(location, target);
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, url: target, text: null };
    }
    try {
      return {
        status: response.status,
        url: target,
        text: await readPrefix(response),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** A URL from what a person typed (`acme.com/pricing`), https only. */
function pageUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (/^http:\/\//i.test(trimmed)) return null;
  const withScheme = /^https:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/** Reads each container until one carries the tag the way that works. */
async function inContainers(containers: string[], siteId: string) {
  let attribute: { id: string; carriesSiteId: boolean } | null = null;
  for (const id of containers) {
    const fetched = await fetchPage(new URL(gtmContainerUrl(id)));
    if (!fetched?.text) continue;
    const state = gtmTag(fetched.text, siteId);
    if (state === "url") return { id, carriesSiteId: true };
    if (state === "attribute" && !attribute) {
      attribute = { id, carriesSiteId: false };
    }
  }
  return attribute;
}

/**
 * Loads one page and looks for the tag, then in the Tag Manager containers
 * the page loads when the HTML has none. Reports on the page it actually
 * fetched, after redirects, and whether it sent a page view just now.
 */
async function verify(organizationId: string, url: string) {
  const { site, domains } = await siteWithDomains(organizationId);
  if (!site.siteId || !trackingReady(site.limitToDomains, domains.length)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Tracking is not ready: add the domain the website runs on first.",
    );
  }
  const target = pageUrl(url);
  if (!target) {
    throw new AppError("VALIDATION_ERROR", `Not an https URL: ${url}`);
  }
  const started = Date.now();
  const fetched = await fetchPage(target);
  const responseMs = Date.now() - started;
  const host = (fetched?.url ?? target).hostname.toLowerCase();
  if (!fetched || fetched.text === null) {
    return {
      status: "unreachable" as const,
      host,
      httpStatus: fetched?.status ?? null,
    };
  }
  const siteId = site.siteId;
  const body = fetched.text;
  const inHtml = body.includes(siteId) && body.includes("/t/crm.js");
  const containers = inHtml ? [] : gtmContainers(body);
  const container = inHtml ? null : await inContainers(containers, siteId);
  if (!inHtml && !container) {
    return { status: "missing" as const, host, responseMs, containers };
  }
  return {
    status: "found" as const,
    host,
    responseMs,
    allowed: hostAllowed(host, trackingConfig(site, siteId, domains)),
    pageView: await WebsiteActivityRepository.seenOnHostSince(
      organizationId,
      host,
      new Date(Date.now() - VERIFY_WINDOW_MS).toISOString(),
    ),
    container,
  };
}

export type TrackingSettings = Awaited<ReturnType<typeof getSettings>>;
export type VerifyResult = Awaited<ReturnType<typeof verify>>;

export const TrackingSettingsService = {
  getSettings,
  setFlag,
  setCookieDays,
  addDomain,
  removeDomain,
  rotateSiteId,
  sources,
  verify,
};
