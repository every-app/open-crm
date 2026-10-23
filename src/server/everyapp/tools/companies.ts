import { mapValues } from "remeda";
import { z } from "zod";
import {
  crmTool,
  fullName,
  memberId,
  ownersInput,
  pageSizeInput,
  personOutput,
  reported,
  reportedOutput,
  sourceOutput,
} from "@/server/everyapp/crm-tool";
import {
  fieldColumnsOutput,
  fieldFiltersInput,
  fieldValuesInput,
  recordValues,
  recordValuesOutput,
  resolveFieldFilters,
  userFieldsByEmail,
  withMemberIds,
} from "@/server/everyapp/tools/fieldFilters";
import {
  CompanyService,
  type CompanyDetail,
  type CompanyListRow,
} from "@/server/features/companies/services/CompanyService";
import {
  DEAL_STAGES,
  ENRICHMENT_STATUSES,
  RECORD_SOURCES,
} from "@/shared/crm-enums";
import {
  COMPANY_SORTS,
  companyListSchema,
  createCompanySchema,
  updateCompanySchema,
} from "@/types/schemas/companies";
import { SORT_DIRECTIONS, UNASSIGNED } from "@/types/schemas/records";

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
  queued: z.boolean().describe("The research agent has work on it due now."),
  source: sourceOutput,
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
  fields: fieldColumnsOutput,
});

type Shown = Awaited<ReturnType<typeof userFieldsByEmail>>;

function summary(
  row: CompanyListRow,
  shown: Shown,
): z.input<typeof summaryOutput> {
  return {
    ...row,
    location: location(row),
    contacts: row.contactCount,
    openDeals: row.openDealCount,
    enrichment: row.enrichmentStatus,
    fields: mapValues(row.fields, (value, key) => shown(key, value)),
  };
}

const detailsOutput = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  industry: z.string().nullable(),
  subIndustry: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  pricingUrl: z.string().nullable(),
  careersUrl: z.string().nullable(),
  owner: personOutput.nullable(),
  source: sourceOutput,
  enrichment,
  enrichmentError: z
    .string()
    .nullable()
    .describe("Why the research agent's last look failed."),
  enrichedAt: z
    .string()
    .nullable()
    .describe("When the research agent last finished with it."),
  queued: z.boolean().describe("The research agent has work on it due now."),
  fields: recordValuesOutput,
  primaryContact: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      title: z.string().nullable(),
    })
    .nullable(),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string().nullable(),
      email: z.string().nullable(),
      owner: personOutput.nullable(),
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
      inReportingCurrency: reportedOutput,
      expectedCloseDate: z.string().nullable(),
      owner: personOutput.nullable(),
    }),
  ),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

function details(
  company: CompanyDetail,
  fields: z.input<typeof recordValuesOutput>,
): z.input<typeof detailsOutput> {
  return {
    ...company,
    enrichment: company.enrichmentStatus,
    fields,
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
    deals: company.deals.map((deal) => ({
      ...deal,
      inReportingCurrency: reported(deal, company.reportingCurrency),
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
      "Search and list companies (accounts) with their domain, industry, location, owner, people, open deals and last activity, and the custom fields shown as table columns. `query` matches part of the name or domain. 25 a page unless pageSize says, newest first unless sorted.",
    risk: "read",
    input: z
      .object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Part of a company's name or domain."),
        owners: ownersInput.describe(
          `Only companies these members own, by email or id; "${UNASSIGNED}" for companies nobody owns.`,
        ),
        industries: companyListSchema.shape.industry
          .unwrap()
          .optional()
          .describe("Only companies in these industries, as listed."),
        enrichment: companyListSchema.shape.enrichment
          .unwrap()
          .optional()
          .describe("Only companies in these research states."),
        sources: z
          .array(z.enum(RECORD_SOURCES))
          .max(RECORD_SOURCES.length)
          .optional()
          .describe("Only companies that came in these ways."),
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
        pageSize: pageSizeInput,
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
      // Only fills in the list's defaults: the input took each filter by the
      // list's own rules.
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
        source: input.sources,
        activity: input.activeWithinDays?.toString(),
        archived: input.archived,
        sort: input.sort,
        // As the list pages: a chosen sort runs ascending unless said.
        dir: input.direction ?? (input.sort ? "asc" : undefined),
        page: input.page,
        pageSize: input.pageSize,
      });
      const [{ rows, total }, shown] = await Promise.all([
        CompanyService.listCompanies(context.organizationId, list),
        userFieldsByEmail(context.organizationId, "COMPANY"),
      ]);
      return {
        total,
        page: list.page,
        pageSize: list.pageSize,
        companies: rows.map((row) => summary(row, shown)),
      };
    },
  }),

  get_company: crmTool({
    description:
      "One company in full: its details and links (pricing and careers pages included), owner, custom fields, the research agent's state, primary contact, and the people who work there and its deals with their owners.",
    risk: "read",
    input: z.object({ id: companyId }).strict(),
    output: detailsOutput,
    handler: async ({ id }, context) => {
      const [company, fields] = await Promise.all([
        CompanyService.getCompany(context.organizationId, id),
        recordValues(context.organizationId, "COMPANY", id),
      ]);
      return details(company, fields);
    },
  }),

  create_company: crmTool({
    description:
      "Add a company, owned by the caller unless ownerEmail is given, with its custom field values if given. Its domain (or a website, reduced to its host) must not belong to another live company. The research agent then fetches its logo and writes its profile.",
    risk: "write",
    input: createCompanySchema
      .omit({ ownerId: true })
      .extend({ ownerEmail: ownerEmail.optional(), fields: fieldValuesInput })
      .strict(),
    output: companyRefOutput,
    handler: async ({ ownerEmail: email, fields, ...input }, context) =>
      CompanyService.createCompany(context.organizationId, {
        ...input,
        ownerId: email
          ? await memberId(context.organizationId, email)
          : context.userId,
        fields:
          fields &&
          (await withMemberIds(context.organizationId, "COMPANY", fields)),
      }),
  }),

  update_company: crmTool({
    description:
      "Change a company's details and custom field values, in one write. Only what is given changes; an empty string clears a detail. A new domain sends the research agent to look again.",
    risk: "write",
    input: updateCompanySchema
      .omit({ ownerId: true })
      .extend({
        id: companyId,
        ownerEmail: ownerEmail
          .nullable()
          .optional()
          .describe("The new owner's email, or null for nobody."),
        fields: fieldValuesInput,
      })
      .strict(),
    output: companyRefOutput,
    handler: async ({ ownerEmail: email, fields, ...input }, context) =>
      CompanyService.updateCompany(context.organizationId, {
        ...input,
        ownerId:
          email === undefined
            ? undefined
            : email && (await memberId(context.organizationId, email)),
        fields:
          fields &&
          (await withMemberIds(context.organizationId, "COMPANY", fields)),
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
