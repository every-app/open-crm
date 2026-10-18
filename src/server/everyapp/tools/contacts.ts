import { z } from "zod";
import { crmTool, memberId } from "@/server/everyapp/crm-tool";
import {
  fieldFiltersInput,
  resolveFieldFilters,
} from "@/server/everyapp/tools/fieldFilters";
import {
  ContactService,
  type ContactDetail,
  type ContactListRow,
} from "@/server/features/contacts/services/ContactService";
import {
  CONTACT_SORTS,
  NO_COMPANY,
  contactListSchema,
  createContactSchema,
  updateContactSchema,
} from "@/types/schemas/contacts";
import {
  FACET_FILTER_MAX,
  SORT_DIRECTIONS,
  UNASSIGNED,
} from "@/types/schemas/records";

// The contacts (people) as an AI client sees them. Owners are named by email
// here, as a model knows them; the app's own forms use member ids.

const ownerEmail = z
  .string()
  .email()
  .describe("The email of the member who owns the contact.");

const contactId = z
  .string()
  .min(1)
  .describe("The contact's id, from list_contacts.");

const companyId = z
  .string()
  .min(1)
  .describe("A live company's id, from list_companies.");

function fullName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function owner(value: ContactListRow["owner"]) {
  return value ? { name: value.name, email: value.email } : null;
}

function company(value: ContactListRow["company"]) {
  return value
    ? { id: value.id, name: value.name, domain: value.domain }
    : null;
}

function summary(row: ContactListRow) {
  return {
    id: row.id,
    name: fullName(row),
    email: row.email,
    title: row.title,
    company: company(row.company),
    owner: owner(row.owner),
    lastActivityAt: row.lastActivityAt,
    enrichment: row.enrichmentStatus,
    archivedAt: row.archivedAt,
    fields: row.fields,
  };
}

function details(contact: ContactDetail) {
  const { relationship, brief } = contact;
  return {
    id: contact.id,
    name: fullName(contact),
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    seniority: contact.seniority,
    function: contact.function,
    linkedinUrl: contact.linkedinUrl,
    twitterUrl: contact.twitterUrl,
    githubUrl: contact.githubUrl,
    company: company(contact.company),
    primaryContactOfCompany: contact.isPrimaryContact,
    owner: owner(contact.owner),
    enrichment: contact.enrichmentStatus,
    brief: brief
      ? {
          narrative: brief.narrative,
          ...brief.sections,
          sourceUrl: brief.sourceUrl,
          refreshedAt: brief.refreshedAt,
        }
      : null,
    // What the research agent found but a person hasn't accepted yet.
    suggestions: contact.facts
      .filter((fact) => fact.status === "PROPOSED")
      .map((fact) => ({
        field: fact.field,
        value: fact.value,
        band: fact.band,
        why: fact.evidence.map((item) => item.detail),
      })),
    deals: contact.deals.map((deal) => ({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      open: deal.open,
      role: deal.role,
      amount: deal.amount,
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
    })),
    colleagues: relationship.colleagues,
    emails: relationship.emails,
    lastReplyAt: relationship.lastReplyAt,
    meetings: relationship.meetings,
    nextMeeting: relationship.nextMeeting,
    lastActivityAt: contact.lastActivityAt,
    createdAt: contact.createdAt,
    archivedAt: contact.archivedAt,
  };
}

export const contactTools = {
  list_contacts: crmTool({
    description:
      "Search and list the CRM's contacts (people): email, title, company, owner, and when anything last happened. Every word of `query` must match their name, email or company name; `fields` filters by custom fields, and each contact comes with the values of the fields shown as table columns (a select as its label). 25 a page, newest first unless sorted.",
    risk: "read",
    input: z
      .object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Words from a contact's name, email or company."),
        owners: z
          .array(z.string())
          .max(20)
          .optional()
          .describe(
            `Only contacts these members own, by email; "${UNASSIGNED}" for contacts nobody owns.`,
          ),
        companyIds: z
          .array(z.string())
          .max(FACET_FILTER_MAX)
          .optional()
          .describe(
            `Only contacts at these companies, by id from list_companies; "${NO_COMPANY}" for contacts at no company.`,
          ),
        titles: z
          .array(z.string())
          .max(FACET_FILTER_MAX)
          .optional()
          .describe("Only contacts with exactly these titles."),
        seniorities: z
          .array(z.string())
          .max(FACET_FILTER_MAX)
          .optional()
          .describe(
            "Only contacts at these seniorities, as get_contact gives them.",
          ),
        personas: z
          .array(z.string())
          .max(FACET_FILTER_MAX)
          .optional()
          .describe(
            "Only contacts in these functions (get_contact's `function`).",
          ),
        activeWithinDays: z
          .literal([7, 30, 90])
          .optional()
          .describe(
            "Only contacts with activity in the last 7, 30 or 90 days.",
          ),
        archived: z
          .boolean()
          .optional()
          .describe("List archived contacts instead of live ones."),
        fields: fieldFiltersInput,
        sort: z.enum(CONTACT_SORTS).optional(),
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
      const list = contactListSchema.parse({
        fields: await resolveFieldFilters(
          context.organizationId,
          "CONTACT",
          input.fields,
        ),
        q: input.query,
        owner: owners,
        company: input.companyIds,
        title: input.titles,
        seniority: input.seniorities,
        persona: input.personas,
        activity: input.activeWithinDays?.toString(),
        archived: input.archived,
        sort: input.sort,
        dir: input.direction,
        page: input.page,
      });
      const { rows, total } = await ContactService.listContacts(
        context.organizationId,
        list,
      );
      return {
        total,
        page: list.page,
        pageSize: list.pageSize,
        contacts: rows.map(summary),
      };
    },
  }),

  get_contact: crmTool({
    description:
      "One contact in full: their details, company, owner, the research agent's brief on them and its suggestions still waiting for a person, the deals they are on, their colleagues, and the mail and meetings captured with them.",
    risk: "read",
    input: z.object({ id: contactId }).strict(),
    handler: async ({ id }, context) =>
      details(await ContactService.getContact(context.organizationId, id)),
  }),

  create_contact: crmTool({
    description:
      "Add a contact. Their email must not belong to another live contact. Without a companyId, a work email files them under the company with that email's domain, adding the company if there is none (free mail such as gmail.com files them nowhere). The research agent then looks the person up.",
    risk: "write",
    input: createContactSchema
      .omit({ ownerId: true })
      .extend({
        companyId: companyId.optional(),
        ownerEmail: ownerEmail.optional(),
      })
      .strict(),
    handler: async ({ ownerEmail: email, ...input }, context) =>
      ContactService.createContact(context.organizationId, {
        ...input,
        ownerId: email ? await memberId(context.organizationId, email) : null,
      }),
  }),

  update_contact: crmTool({
    description:
      "Change a contact's details. Only the fields given change; an empty string clears a field. A null companyId takes them off their company.",
    risk: "write",
    input: updateContactSchema
      .omit({ ownerId: true })
      .extend({
        id: contactId,
        companyId: companyId.nullable().optional(),
        ownerEmail: ownerEmail
          .nullable()
          .optional()
          .describe("The new owner's email, or null for nobody."),
      })
      .strict(),
    handler: async ({ ownerEmail: email, ...input }, context) =>
      ContactService.updateContact(context.organizationId, {
        ...input,
        ownerId:
          email === undefined
            ? undefined
            : email && (await memberId(context.organizationId, email)),
      }),
  }),

  archive_contact: crmTool({
    description:
      "Archive a contact: they leave every list and their email is free for another contact. A person can restore them from the Archived view.",
    risk: "destructive",
    input: z.object({ id: contactId }).strict(),
    handler: ({ id }, context) =>
      ContactService.archiveContact(context.organizationId, id),
  }),
};
