import { TrackingSettingsService } from "@/server/features/tracking/services/TrackingSettingsService";

/** A site tracking `host` (and its subdomains), ready, with its site id. */
export async function readySite(organizationId: string, host: string) {
  await TrackingSettingsService.addDomain(organizationId, {
    host,
    scope: "SITE_AND_SUBDOMAINS",
  });
  const settings = await TrackingSettingsService.getSettings(
    organizationId,
    "https://crm.example.com",
  );
  if (!settings.siteId) throw new Error("A ready site has a site id");
  return settings.siteId;
}

/** A page view on `host`, as the tracker sends it. */
export function pageView(
  host: string,
  overrides: Record<string, unknown> = {},
) {
  return { type: "page_view", host, path: "/pricing", ...overrides };
}

/** A form submission on `host`, as the tracker sends it. */
export function formSubmit(
  host: string,
  fields: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  return { type: "form_submit", host, path: "/contact", fields, ...overrides };
}

/** The body of a tracker POST. */
export function batch(
  siteId: string,
  events: unknown[],
  visitorId = "visitor_0001",
) {
  return JSON.stringify({ siteId, visitorId, events });
}
