import { keys } from "remeda";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { crmTool, fullName } from "@/server/everyapp/crm-tool";
import { TrackingSettingsService } from "@/server/features/tracking/services/TrackingSettingsService";
import { WebsiteActivityService } from "@/server/features/tracking/services/WebsiteActivityService";
import { COOKIE_LIFETIMES, DOMAIN_SCOPES } from "@/shared/tracking";
import { addTrackedDomainSchema } from "@/types/schemas/tracking";

// Website tracking for AI clients: what a company's or contact's browsers did
// on the website, the tracking settings and traffic sources, and the settings
// page's switches for owners and admins (pause, the rules, the cookies, the
// allowed domains). Verify installation and the site id's rotation stay with
// people.

const touchOutput = z
  .object({
    label: z.string().describe("Where they came from, in words."),
    source: z.string(),
    medium: z.string().nullable(),
    campaign: z.string().nullable(),
    landing: z.string().nullable(),
    at: z.string().nullable(),
  })
  .nullable();

const domainOutput = z.object({
  id: z.string(),
  host: z.string(),
  scope: z.enum(DOMAIN_SCOPES),
  pageViews: z.number(),
  lastSeenAt: z.string().nullable(),
});

// The settings page's switches, as update_tracking_settings takes them.
const switches = {
  crossDomain: z
    .boolean()
    .describe(
      "Links between the allowed domains carry the visitor along, so one person is one visitor across them.",
    ),
  limitToDomains: z
    .boolean()
    .describe("Only the domains listed may send page views."),
  cookieSubdomains: z
    .boolean()
    .describe(
      "The visitor cookie stays on the exact host instead of the whole site and its subdomains.",
    ),
  secureCookies: z.boolean().describe("Cookies are set over https only."),
  honourDnt: z
    .boolean()
    .describe(
      "Browsers that send Do Not Track or Global Privacy Control aren't tracked.",
    ),
};

const COOKIE_DAYS = `How long the visitor cookie lasts, in days: ${COOKIE_LIFETIMES.map(({ days, label }) => `${days} (${label.toLowerCase()})`).join(", ")}.`;

const settingsOutput = z.object({
  ready: z
    .boolean()
    .describe("The snippet works: a domain is allowed, or any site is."),
  paused: z.boolean(),
  ...switches,
  cookieDays: z.number().describe(COOKIE_DAYS),
  domains: z.array(domainOutput),
  pageViews: z.number(),
  submissions: z.number(),
  receivingSince: z
    .string()
    .nullable()
    .describe("When the latest page view or form arrived."),
  snippet: z
    .string()
    .nullable()
    .describe("The script tag for the website's <head>, once ready."),
});

async function settings(organizationId: string, origin: string) {
  return TrackingSettingsService.getSettings(organizationId, origin);
}

const manage = { workspace: ["manage" as const] };

export const trackingTools = {
  get_website_activity: crmTool({
    description:
      "What a contact's browsers did on the website, or a company's people's: visits, page views, the top pages, where they first and last came from, and their latest form submissions. Empty until a form submission identifies someone.",
    risk: "read",
    input: z
      .object({
        kind: z.enum(["company", "contact"]),
        id: z
          .string()
          .min(1)
          .describe("The company's or contact's id, from the list tools."),
      })
      .strict(),
    output: z.object({
      identified: z.boolean(),
      visitors: z.number(),
      views: z.number(),
      lastSeenAt: z.string().nullable(),
      pages: z.array(
        z.object({
          host: z.string(),
          path: z.string(),
          views: z.number(),
          lastSeenAt: z.string(),
        }),
      ),
      firstTouch: touchOutput,
      lastTouch: touchOutput,
      submissions: z.array(
        z.object({
          host: z.string(),
          path: z.string(),
          submittedAt: z.string(),
          contact: z.object({ id: z.string(), name: z.string() }),
        }),
      ),
    }),
    handler: async ({ kind, id }, context) => {
      const record = kind === "contact" ? { contactId: id } : { companyId: id };
      const [activity, submissions] = await Promise.all([
        WebsiteActivityService.forRecord(context.organizationId, record),
        WebsiteActivityService.submissions(context.organizationId, record),
      ]);
      return {
        ...activity,
        submissions: submissions.map((row) => ({
          ...row,
          contact: { id: row.contactId, name: fullName(row) },
        })),
      };
    },
  }),

  get_tracking_settings: crmTool({
    description:
      "Website tracking's state: whether it is ready or paused, its rules and cookies, the allowed domains, totals, when data last arrived, and the snippet to install.",
    risk: "read",
    input: z.object({}).strict(),
    output: settingsOutput,
    handler: (_input, context, { origin }) =>
      settings(context.organizationId, origin),
  }),

  get_traffic_sources: crmTool({
    description:
      "Where the website's visitors come from (owners and admins only): page views per source and medium, and how many contacts each first brought in. Top 20.",
    risk: "read",
    input: z.object({}).strict(),
    output: z.object({
      sources: z.array(
        z.object({
          source: z.string(),
          medium: z.string().nullable(),
          views: z.number(),
          contacts: z.number(),
        }),
      ),
    }),
    handler: async (_input, context) => {
      requireOrgPermission(context, manage);
      return {
        sources: await TrackingSettingsService.sources(context.organizationId),
      };
    },
  }),

  set_tracking_paused: crmTool({
    description:
      "Pause website tracking, or resume it with paused: false (owners and admins only). The script stops or starts recording within five minutes.",
    risk: "write",
    input: z.object({ paused: z.boolean() }).strict(),
    output: settingsOutput,
    handler: async ({ paused }, context, { origin }) => {
      requireOrgPermission(context, manage);
      await TrackingSettingsService.setFlag(
        context.organizationId,
        "paused",
        paused,
      );
      return settings(context.organizationId, origin);
    },
  }),

  update_tracking_settings: crmTool({
    description:
      "Change website tracking's rules and cookies (owners and admins only); only what is given changes. Browsers pick it up within five minutes. set_tracking_paused pauses tracking.",
    risk: "write",
    input: z
      .object({
        crossDomain: switches.crossDomain.optional(),
        limitToDomains: switches.limitToDomains.optional(),
        cookieSubdomains: switches.cookieSubdomains.optional(),
        secureCookies: switches.secureCookies.optional(),
        honourDnt: switches.honourDnt.optional(),
        cookieDays: z
          .literal(COOKIE_LIFETIMES.map((lifetime) => lifetime.days))
          .optional()
          .describe(COOKIE_DAYS),
      })
      .strict(),
    output: settingsOutput,
    handler: async (input, context, { origin }) => {
      requireOrgPermission(context, manage);
      for (const flag of keys(switches)) {
        const enabled = input[flag];
        if (enabled === undefined) continue;
        await TrackingSettingsService.setFlag(
          context.organizationId,
          flag,
          enabled,
        );
      }
      if (input.cookieDays !== undefined) {
        await TrackingSettingsService.setCookieDays(
          context.organizationId,
          input.cookieDays,
        );
      }
      return settings(context.organizationId, origin);
    },
  }),

  add_tracked_domain: crmTool({
    description:
      "Allow a domain to send page views (owners and admins only): the site and its subdomains, or that exact host.",
    risk: "write",
    input: z
      .object({
        host: addTrackedDomainSchema.shape.host.describe(
          "The domain, like acme.com.",
        ),
        scope: addTrackedDomainSchema.shape.scope
          .optional()
          .describe("SITE_AND_SUBDOMAINS (the default) or EXACT_HOST."),
      })
      .strict(),
    output: settingsOutput,
    handler: async ({ host, scope }, context, { origin }) => {
      requireOrgPermission(context, manage);
      await TrackingSettingsService.addDomain(context.organizationId, {
        host,
        scope: scope ?? "SITE_AND_SUBDOMAINS",
      });
      return settings(context.organizationId, origin);
    },
  }),

  remove_tracked_domain: crmTool({
    description:
      "Take a domain off the allowed list (owners and admins only). With the list limited to its domains, that site stops sending page views.",
    risk: "write",
    input: z
      .object({
        id: z
          .string()
          .min(1)
          .describe("The domain's id, from get_tracking_settings."),
      })
      .strict(),
    output: settingsOutput,
    handler: async ({ id }, context, { origin }) => {
      requireOrgPermission(context, manage);
      await TrackingSettingsService.removeDomain(context.organizationId, id);
      return settings(context.organizationId, origin);
    },
  }),
};
