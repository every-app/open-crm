import { mapValues } from "remeda";
import { z } from "zod";
import {
  crmTool,
  fullName,
  memberId,
  pageSizeInput,
  personOutput,
  sourceOutput,
} from "@/server/everyapp/crm-tool";
import { suggestionOutput } from "@/server/everyapp/tools/suggestions";
import {
  fieldColumnsOutput,
  fieldFiltersInput,
  resolveFieldFilters,
  userFieldsByEmail,
} from "@/server/everyapp/tools/fieldFilters";
import {
  ContactService,
  type ContactDetail,
  type ContactListRow,
} from "@/server/features/contacts/services/ContactService";
import {
  DEAL_STAGES,
  ENRICHMENT_STATUSES,
  RECORD_SOURCES,
} from "@/shared/crm-enums";
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
  .describe("The contact's id, from list_contacts or search_records.");

const companyId = z
  .string()
  .min(1)
  .describe("A live company's id, from list_companies.");

const companyOutput = z
  .object({ id: z.string(), name: z.string(), domain: z.string().nullable() })
  .nullable();

const enrichment = z
  .enum(ENRICHMENT_STATUSES)
  .describe(
    "The research agent's state: PENDING, RUNNING, COMPLETE, FAILED or SKIPPED (nothing found).",
  );

const summaryOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  title: z.string().nullable(),
  company: companyOutput,
  owner: personOutput.nullable(),
  lastActivityAt: z.string().nullable(),
  enrichment,
  source: sourceOutput,
  archivedAt: z.string().nullable(),
  fields: fieldColumnsOutput,
});

type Shown = Awaited<ReturnType<typeof userFieldsByEmail>>;

function summary(
  row: ContactListRow,
  shown: Shown,
): z.input<typeof summaryOutput> {
  return {
    ...row,
    name: fullName(row),
    enrichment: row.enrichmentStatus,
    fields: mapValues(row.fields, (value, key) => shown(key, value)),
  };
}

const detailsOutput = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  seniority: z.string().nullable(),
  function: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  company: companyOutput,
  primaryContactOfCompany: z.boolean(),
  owner: personOutput.nullable(),
  enrichment,
  brief: z
    .object({
      narrative: z.string().nullable(),
      currentRole: z.string().optional(),
      tenure: z.string().optional(),
      previousRoles: z.array(z.string()).optional(),
      seniority: z.string().optional(),
      function: z.string().optional(),
      location: z.string().optional(),
      sourceUrl: z.string().nullable(),
      refreshedAt: z.string(),
    })
    .nullable()
    .describe("The research agent's brief on them."),
  suggestions: z
    .array(suggestionOutput)
    .describe("What the research agent found that waits for a person."),
  deals: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      stage: z.enum(DEAL_STAGES),
      open: z.boolean(),
      role: z.string().nullable(),
      amount: z.number().nullable(),
      currency: z.string(),
      expectedCloseDate: z.string().nullable(),
    }),
  ),
  colleagues: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string().nullable(),
    }),
  ),
  emails: z.number().describe("Captured emails with them."),
  lastReplyAt: z.string().nullable(),
  meetings: z.number().describe("Captured meetings with them."),
  nextMeeting: z
    .object({ title: z.string().nullable(), startsAt: z.string() })
    .nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

function details(contact: ContactDetail): z.input<typeof detailsOutput> {
  const { relationship, brief } = contact;
  return {
    ...contact,
    ...relationship,
    name: fullName(contact),
    primaryContactOfCompany: contact.isPrimaryContact,
    enrichment: contact.enrichmentStatus,
    brief: brief ? { ...brief, ...brief.sections } : null,
    suggestions: contact.facts
      .filter((fact) => fact.status === "PROPOSED")
      .map((fact) => ({
        ...fact,
        why: fact.evidence.map((item) => item.detail),
      })),
  };
}

const contactRefOutput = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  companyId: z.string().nullable(),
});

export const contactTools = {
  list_contacts: crmTool({
    description:
      "Search and list contacts (people) with their email, title, company, owner and last activity, and the custom fields shown as table columns. Every word of `query` must match their name, email or company. 25 a page unless pageSize says, newest first unless sorted.",
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
            `Only contacts at these companies, by id; "${NO_COMPANY}" for contacts at no company.`,
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
          .describe("Only contacts at these seniorities, as get_contact says."),
        personas: z
          .array(z.string())
          .max(FACET_FILTER_MAX)
          .optional()
          .describe("Only contacts in these functions (get_contact's)."),
        activeWithinDays: z
          .literal([7, 30, 90])
          .optional()
          .describe(
            "Only contacts with activity in the last 7, 30 or 90 days.",
          ),
        sources: z
          .array(z.enum(RECORD_SOURCES))
          .max(RECORD_SOURCES.length)
          .optional()
          .describe("Only contacts who came in these ways."),
        archived: z
          .boolean()
          .optional()
          .describe("List archived contacts instead of live ones."),
        fields: fieldFiltersInput,
        sort: z.enum(CONTACT_SORTS).optional(),
        direction: z.enum(SORT_DIRECTIONS).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: pageSizeInput,
      })
      .strict(),
    output: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      contacts: z.array(summaryOutput),
    }),
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
        ContactService.listContacts(context.organizationId, list),
        userFieldsByEmail(context.organizationId, "CONTACT"),
      ]);
      return {
        total,
        page: list.page,
        pageSize: list.pageSize,
        contacts: rows.map((row) => summary(row, shown)),
      };
    },
  }),

  get_contact: crmTool({
    description:
      "One contact in full: details, company, owner, the research agent's brief and its suggestions waiting for a person, their deals and colleagues, and the mail and meetings captured with them.",
    risk: "read",
    input: z.object({ id: contactId }).strict(),
    output: detailsOutput,
    handler: async ({ id }, context) =>
      details(await ContactService.getContact(context.organizationId, id)),
  }),

  create_contact: crmTool({
    description:
      "Add a contact. Their email must not belong to another live contact. Without a companyId, a work email files them under that domain's company, adding it if missing (free mail such as gmail.com files them nowhere). The research agent then looks them up.",
    risk: "write",
    input: createContactSchema
      .omit({ ownerId: true })
      .extend({
        companyId: companyId.optional(),
        ownerEmail: ownerEmail.optional(),
      })
      .strict(),
    output: contactRefOutput,
    handler: async ({ ownerEmail: email, ...input }, context) =>
      ContactService.createContact(context.organizationId, {
        ...input,
        ownerId: email ? await memberId(context.organizationId, email) : null,
      }),
  }),

  update_contact: crmTool({
    description:
      "Change a contact's details. Only the fields given change; an empty string clears one. A null companyId takes them off their company.",
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
    output: contactRefOutput,
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
      "Archive a contact: they leave every list and their email is free for another contact. bulk_restore brings them back.",
    risk: "write",
    input: z.object({ id: contactId }).strict(),
    output: z.object({ id: z.string(), name: z.string() }),
    handler: ({ id }, context) =>
      ContactService.archiveContact(context.organizationId, id),
  }),
};
