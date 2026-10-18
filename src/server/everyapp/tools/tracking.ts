import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { crmTool, fullName } from "@/server/everyapp/crm-tool";
import { TrackingSettingsService } from "@/server/features/tracking/services/TrackingSettingsService";
import { WebsiteActivityService } from "@/server/features/tracking/services/WebsiteActivityService";
import { DOMAIN_SCOPES } from "@/shared/tracking";
import { addTrackedDomainSchema } from "@/types/schemas/tracking";

// Website tracking for AI clients: what a company's or contact's browsers did
// on the website, the tracking settings and traffic sources, and the switches
// the settings page gives owners and admins (pause, the allowed domains).
// Verify installation and the site id's rotation stay with people.

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

const settingsOutput = z.object({
  ready: z
    .boolean()
    .describe("The snippet works: a domain is allowed, or any site is."),
  paused: z.boolean(),
  limitToDomains: z
    .boolean()
    .describe("Only the domains listed may send page views."),
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
      "Website tracking's state: whether it is ready or paused, the allowed domains, totals, when data last arrived, and the snippet to install.",
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
