import { tool } from "ai";
import { z } from "zod";
import { extractFromSite, type JsonSchema } from "../lib/contextDev";
import { AgentProfileRepository } from "../repositories/AgentProfileRepository";
import { AgentRecordRepository } from "../repositories/AgentRecordRepository";
import { BILLABLE_CALL_UNITS } from "../runtime/budget";
import { contextAccess, runBrand } from "../visible/brand";
import type { ToolGroup } from "./context";

// Company research through Context.dev, ported from the CRM's enrich_company
// and research_company. Each lookup spends the session's budget, and only
// once it is known Context.dev is reachable: a missing key is a missing
// source, never a charge.

const RESEARCH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    positioning: {
      type: "string",
      description: "One paragraph: what they sell and who to.",
    },
    pricingModel: {
      type: "string",
      description: "How they charge — per seat, usage, flat, enterprise-only.",
    },
    targetCustomer: {
      type: "string",
      description: "The customer they describe themselves as serving.",
    },
    notableCustomers: {
      type: "array",
      items: { type: "string" },
      description: "Named customers or logos on the site.",
    },
    recentNews: {
      type: "array",
      items: { type: "string" },
      description: "Recent announcements, funding, or launches.",
    },
  },
  required: ["positioning"],
};

const RESEARCH_INSTRUCTIONS =
  "Read this company's marketing site and answer as a salesperson preparing for a first call. Be specific and factual; leave a field empty rather than guessing.";

const briefText = z.string().trim().min(1).nullable().catch(null);
const briefList = z
  .array(z.string().nullable().catch(null))
  .transform((items) => items.filter((item): item is string => item !== null))
  .catch([]);
const researchBrief = z
  .object({
    positioning: briefText,
    pricingModel: briefText,
    targetCustomer: briefText,
    notableCustomers: briefList,
    recentNews: briefList,
  })
  .catch({
    positioning: null,
    pricingModel: null,
    targetCustomer: null,
    notableCustomers: [],
    recentNews: [],
  });

function formatBrief(brief: z.infer<typeof researchBrief>): string {
  const lines: string[] = [];
  if (brief.positioning) lines.push(brief.positioning);
  if (brief.pricingModel) lines.push(`Pricing: ${brief.pricingModel}`);
  if (brief.targetCustomer) lines.push(`Sells to: ${brief.targetCustomer}`);
  if (brief.notableCustomers.length > 0) {
    lines.push(`Customers: ${brief.notableCustomers.join(", ")}`);
  }
  if (brief.recentNews.length > 0) {
    lines.push(
      `Recently:\n${brief.recentNews.map((item) => `• ${item}`).join("\n")}`,
    );
  }
  return lines.join("\n\n");
}

export const researchTools: ToolGroup = (context) => ({
  enrich_company: tool({
    description:
      "Look up a company's brand, industry, location and social links by domain, and fill in the blanks on its record. Fills empty fields only — never overwrites what a person typed.",
    inputSchema: z.object({
      companyId: z.string(),
      fresh: z
        .boolean()
        .default(false)
        .describe(
          "Bypass the vendor's ~90-day cache. Only when a rep has asked for a fresh look.",
        ),
    }),
    execute: async ({ companyId, fresh }) => {
      const result = await runBrand({
        organizationId: context.organizationId,
        companyId,
        fresh,
        spend: context.spend,
      });
      if (!result.enriched) {
        return {
          enriched: false as const,
          reason: result.reason,
          retryable: result.retryable,
        };
      }
      const filled = result.filled ?? [];
      return {
        enriched: true as const,
        filled,
        mirrored: result.mirrored ?? [],
        note:
          filled.length === 0
            ? "Everything it returned was already on the record."
            : undefined,
      };
    },
  }),

  research_company: tool({
    description:
      "Read a company's marketing site and write a research brief to its timeline: positioning, pricing, who they sell to, notable customers, recent news.",
    inputSchema: z.object({ companyId: z.string() }),
    execute: async ({ companyId }) => {
      const company = await AgentRecordRepository.companySite(
        context.organizationId,
        companyId,
      );
      if (!company)
        return { written: false as const, reason: "No such company." };
      const site = company.website ?? company.domain;
      if (!site) {
        return {
          written: false as const,
          reason: "This company has no website.",
        };
      }
      const contextFetch = await contextAccess();
      if (!contextFetch) {
        return {
          written: false as const,
          reason:
            "This install has no Context.dev, so the site cannot be read for a brief. This is not a failure and retrying will not help — use what the CRM already knows.",
        };
      }
      const charge = context.spend(BILLABLE_CALL_UNITS);
      if (!charge.ok) return { written: false as const, reason: charge.reason };
      const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
      const result = await extractFromSite(
        contextFetch,
        url,
        RESEARCH_SCHEMA,
        RESEARCH_INSTRUCTIONS,
      );
      if (result.outcome === "failed") {
        return { written: false as const, reason: result.reason };
      }
      const body = formatBrief(researchBrief.parse(result.data));
      if (!body) {
        return {
          written: false as const,
          reason: "The site said nothing usable.",
        };
      }
      const activityId = await AgentProfileRepository.addCompanyBrief(
        context.organizationId,
        {
          companyId,
          subject: `Research brief — ${company.name}`,
          body,
          meta: {
            source: "context.dev",
            endpoint: "web/extract",
            agent: "research",
            sessionId: context.sessionId,
          },
        },
      );
      return activityId
        ? { written: true as const, activityId }
        : { written: false as const, reason: "No such company." };
    },
  }),
});
