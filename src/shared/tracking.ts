// Website tracking values the settings page and the server share.

/** How an allowed domain matches a page's host. */
export const DOMAIN_SCOPES = ["SITE_AND_SUBDOMAINS", "EXACT_HOST"] as const;
export type DomainScope = (typeof DOMAIN_SCOPES)[number];

export const DOMAIN_SCOPE_LABELS: Record<DomainScope, string> = {
  SITE_AND_SUBDOMAINS: "Site + subdomains",
  EXACT_HOST: "Exact host",
};

/** The visitor cookie's lifetimes on offer; 0 is a session cookie. */
export const COOKIE_LIFETIMES = [
  { days: 395, label: "13 months" },
  { days: 180, label: "6 months" },
  { days: 0, label: "Session only" },
] as const;

/** The on/off settings of a site's tracking. */
export const TRACKING_FLAGS = [
  "crossDomain",
  "limitToDomains",
  "cookieSubdomains",
  "secureCookies",
  "honourDnt",
  "paused",
] as const;
export type TrackingFlag = (typeof TRACKING_FLAGS)[number];
