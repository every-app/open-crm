import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import {
  CompanyService,
  type CompanyDetail,
  type CompanyListRow,
} from "@/server/features/companies/services/CompanyService";
import { AppError } from "@/server/lib/errors";
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

/** A member's user id from their email, as the tools take owners. */
export async function memberId(organizationId: string, email: string) {
  const members = await AuthRepository.listMembers(organizationId);
  const member = members.find(
    (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!member) {
    throw new AppError(
      "VALIDATION_ERROR",
      `No member of this organization has the email ${email}.`,
    );
  }
  return member.userId;
}

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

function owner(value: CompanyListRow["owner"]) {
  return value ? { name: value.name, email: value.email } : null;
}

function summary(row: CompanyListRow) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    location: location(row),
    owner: owner(row.owner),
    contacts: row.contactCount,
    openDeals: row.openDealCount,
    lastActivityAt: row.lastActivityAt,
    enrichment: row.enrichmentStatus,
    archivedAt: row.archivedAt,
  };
}

function fullName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function details(company: CompanyDetail) {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    website: company.website,
    description: company.description,
    industry: company.industry,
    location: location(company),
    phone: company.phone,
    email: company.email,
    linkedinUrl: company.linkedinUrl,
    twitterUrl: company.twitterUrl,
    githubUrl: company.githubUrl,
    owner: owner(company.owner),
    enrichment: company.enrichmentStatus,
    primaryContact: company.primaryContact
      ? {
          id: company.primaryContact.id,
          name: fullName(company.primaryContact),
          email: company.primaryContact.email,
          title: company.primaryContact.title,
        }
      : null,
    contacts: company.contacts.map((contact) => ({
      id: contact.id,
      name: fullName(contact),
      title: contact.title,
      email: contact.email,
    })),
    deals: company.deals.map((deal) => ({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      open: deal.open,
      amount: deal.amount,
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
    })),
    lastActivityAt: company.lastActivityAt,
    createdAt: company.createdAt,
    archivedAt: company.archivedAt,
  };
}

const companyId = z
  .string()
  .min(1)
  .describe("The company's id, from list_companies.");

export const companyTools = {
  list_companies: crmTool({
    description:
      "Search and list the CRM's companies (accounts): domain, industry, location, owner, how many contacts and open deals each has, and when anything last happened. `query` matches part of the name or domain. 25 a page, newest first unless sorted.",
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
        archived: z
          .boolean()
          .optional()
          .describe("List archived companies instead of live ones."),
        sort: z.enum(COMPANY_SORTS).optional(),
        direction: z.enum(SORT_DIRECTIONS).optional(),
        page: z.number().int().min(1).optional(),
      })
      .strict(),
    handler: async (input, context) => {
      const owners = await Promise.all(
        (input.owners ?? []).map((value) =>
          value === UNASSIGNED
            ? UNASSIGNED
            : memberId(context.organizationId, value),
        ),
      );
      const list = companyListSchema.parse({
        q: input.query,
        owner: owners,
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
    handler: async ({ id }, context) =>
      details(await CompanyService.getCompany(context.organizationId, id)),
  }),

  create_company: crmTool({
    description:
      "Add a company. The domain (or a website URL, reduced to its host) must not belong to another live company. The research agent then fetches its logo and writes its profile.",
    risk: "write",
    input: createCompanySchema
      .omit({ ownerId: true })
      .extend({ ownerEmail: ownerEmail.optional() })
      .strict(),
    handler: async ({ ownerEmail: email, ...input }, context) =>
      CompanyService.createCompany(context.organizationId, {
        ...input,
        ownerId: email ? await memberId(context.organizationId, email) : null,
      }),
  }),

  update_company: crmTool({
    description:
      "Change a company's details. Only the fields given change; an empty string clears a field. A new domain sends the research agent to look again.",
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
    handler: async ({ ownerEmail: email, ...input }, context) =>
      CompanyService.updateCompany(context.organizationId, {
        ...input,
        ownerId:
          email === undefined
            ? undefined
            : email && (await memberId(context.organizationId, email)),
      }),
  }),

  archive_company: crmTool({
    description:
      "Archive a company: it leaves every list and its domain is free for another company. A person can restore it from the Archived view.",
    risk: "destructive",
    input: z.object({ id: companyId }).strict(),
    handler: ({ id }, context) =>
      CompanyService.archiveCompany(context.organizationId, id),
  }),
};
