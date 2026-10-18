import { z } from "zod";
import {
  crmTool,
  fullName,
  memberId,
  personOutput,
} from "@/server/everyapp/crm-tool";
import {
  fieldColumnsOutput,
  fieldFiltersInput,
  resolveFieldFilters,
} from "@/server/everyapp/tools/fieldFilters";
import {
  CompanyService,
  type CompanyDetail,
  type CompanyListRow,
} from "@/server/features/companies/services/CompanyService";
import { DEAL_STAGES, ENRICHMENT_STATUSES } from "@/shared/crm-enums";
import {
  COMPANY_SORTS,
  companyListSchema,
  createCompanySchema,
  updateCompanySchema,
} from "@/types/schemas/companies";
import {
  FACET_FILTER_MAX,
  SORT_DIRECTIONS,
  UNASSIGNED,
} from "@/types/schemas/records";

// The companies (accounts) as an AI client sees them. People are named by
// email here, as a model knows them; the app's own forms use member ids.

const ownerEmail = z
  .string()
  .email()
  .describe("The email of the member who owns the company.");

function location(company: {
  city: string | null;
  stateCode: string | null;
  country: string | null;
}) {
  const parts = [company.city, company.stateCode, company.country].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

const enrichment = z
  .enum(ENRICHMENT_STATUSES)
  .describe(
    "The research agent's state: PENDING, RUNNING, COMPLETE, FAILED or SKIPPED (nothing found).",
  );

const summaryOutput = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  location: z.string().nullable(),
  owner: personOutput.nullable(),
  contacts: z.number(),
  openDeals: z.number(),
  lastActivityAt: z.string().nullable(),
  enrichment,
  archivedAt: z.string().nullable(),
  fields: fieldColumnsOutput,
});

function summary(row: CompanyListRow): z.input<typeof summaryOutput> {
  return {
    ...row,
    location: location(row),
    contacts: row.contactCount,
    openDeals: row.openDealCount,
    enrichment: row.enrichmentStatus,
  };
}

const detailsOutput = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  industry: z.string().nullable(),
  location: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  owner: personOutput.nullable(),
  enrichment,
  primaryContact: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      title: z.string().nullable(),
    })
    .nullable(),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  deals: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      stage: z.enum(DEAL_STAGES),
      open: z.boolean(),
      amount: z.number().nullable(),
      currency: z.string(),
      expectedCloseDate: z.string().nullable(),
    }),
  ),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

function details(company: CompanyDetail): z.input<typeof detailsOutput> {
  return {
    ...company,
    location: location(company),
    enrichment: company.enrichmentStatus,
    primaryContact: company.primaryContact
      ? {
          ...company.primaryContact,
          name: fullName(company.primaryContact),
        }
      : null,
    contacts: company.contacts.map((contact) => ({
      ...contact,
      name: fullName(contact),
    })),
  };
}

const companyRefOutput = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
});

const companyId = z
  .string()
  .min(1)
  .describe("The company's id, from list_companies or search_records.");

export const companyTools = {
  list_companies: crmTool({
    description:
      "Search and list companies (accounts) with their domain, industry, location, owner, people, open deals and last activity, and the custom fields shown as table columns. `query` matches part of the name or domain. 25 a page, newest first unless sorted.",
    risk: "read",
    input: z
      .object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Part of a company's name or domain."),
        owners: z
          .array(z.string())
          .max(20)
          .optional()
          .describe(
            `Only companies these members own, by email; "${UNASSIGNED}" for companies nobody owns.`,
          ),
        industries: z
          .array(z.string())
          .max(FACET_FILTER_MAX)
          .optional()
          .describe("Only companies in these industries, as listed."),
        enrichment: z
          .array(z.enum(ENRICHMENT_STATUSES))
          .optional()
          .describe("Only companies in these research states."),
        activeWithinDays: z
          .literal([7, 30, 90])
          .optional()
          .describe(
            "Only companies with activity in the last 7, 30 or 90 days.",
          ),
        archived: z
          .boolean()
          .optional()
          .describe("List archived companies instead of live ones."),
        fields: fieldFiltersInput,
        sort: z.enum(COMPANY_SORTS).optional(),
        direction: z.enum(SORT_DIRECTIONS).optional(),
        page: z.number().int().min(1).optional(),
      })
      .strict(),
    output: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      companies: z.array(summaryOutput),
    }),
    handler: async (input, context) => {
      const owners = await Promise.all(
        (input.owners ?? []).map((value) =>
          value === UNASSIGNED
            ? UNASSIGNED
            : memberId(context.organizationId, value),
        ),
      );
      const list = companyListSchema.parse({
        fields: await resolveFieldFilters(
          context.organizationId,
          "COMPANY",
          input.fields,
        ),
        q: input.query,
        owner: owners,
        industry: input.industries,
        enrichment: input.enrichment,
        activity: input.activeWithinDays?.toString(),
        archived: input.archived,
        sort: input.sort,
        dir: input.direction,
        page: input.page,
      });
      const { rows, total } = await CompanyService.listCompanies(
        context.organizationId,
        list,
      );
      return {
        total,
        page: list.page,
        pageSize: list.pageSize,
        companies: rows.map(summary),
      };
    },
  }),

  get_company: crmTool({
    description:
      "One company in full: its details, owner, primary contact, the people who work there and its deals.",
    risk: "read",
    input: z.object({ id: companyId }).strict(),
    output: detailsOutput,
    handler: async ({ id }, context) =>
      details(await CompanyService.getCompany(context.organizationId, id)),
  }),

  create_company: crmTool({
    description:
      "Add a company. Its domain (or a website, reduced to its host) must not belong to another live company. The research agent then fetches its logo and writes its profile.",
    risk: "write",
    input: createCompanySchema
      .omit({ ownerId: true })
      .extend({ ownerEmail: ownerEmail.optional() })
      .strict(),
    output: companyRefOutput,
    handler: async ({ ownerEmail: email, ...input }, context) =>
      CompanyService.createCompany(context.organizationId, {
        ...input,
        ownerId: email ? await memberId(context.organizationId, email) : null,
      }),
  }),

  update_company: crmTool({
    description:
      "Change a company's details. Only the fields given change; an empty string clears one. A new domain sends the research agent to look again.",
    risk: "write",
    input: updateCompanySchema
      .omit({ ownerId: true })
      .extend({
        id: companyId,
        ownerEmail: ownerEmail
          .nullable()
          .optional()
          .describe("The new owner's email, or null for nobody."),
      })
      .strict(),
    output: companyRefOutput,
    handler: async ({ ownerEmail: email, ...input }, context) =>
      CompanyService.updateCompany(context.organizationId, {
        ...input,
        ownerId:
          email === undefined
            ? undefined
            : email && (await memberId(context.organizationId, email)),
      }),
  }),

  set_primary_contact: crmTool({
    description:
      "Make someone who works at the company its primary contact, or clear it with null.",
    risk: "write",
    input: z
      .object({
        companyId,
        contactId: z
          .string()
          .min(1)
          .nullable()
          .describe("The contact's id; get_company lists who works there."),
      })
      .strict(),
    output: z.object({
      id: z.string(),
      primaryContactId: z.string().nullable(),
    }),
    handler: ({ companyId: id, contactId }, context) =>
      CompanyService.setPrimaryContact(context.organizationId, id, contactId),
  }),

  archive_company: crmTool({
    description:
      "Archive a company: it leaves every list and its domain is free for another company. bulk_restore brings it back.",
    risk: "write",
    input: z.object({ id: companyId }).strict(),
    output: z.object({ id: z.string(), name: z.string() }),
    handler: ({ id }, context) =>
      CompanyService.archiveCompany(context.organizationId, id),
  }),
};
