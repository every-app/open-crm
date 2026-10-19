import { mapValues } from "remeda";
import { z } from "zod";
import {
  crmTool,
  fullName,
  memberId,
  ownersInput,
  pageSizeInput,
  personOutput,
  sourceOutput,
} from "@/server/everyapp/crm-tool";
import { suggestionOutput } from "@/server/everyapp/tools/suggestions";
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
  ContactService,
  type ContactDetail,
  type ContactListRow,
} from "@/server/features/contacts/services/ContactService";
import {
  DEAL_STAGES,
  ENRICHMENT_STATUSES,
  FACT_BANDS,
  RECORD_SOURCES,
} from "@/shared/crm-enums";
import {
  CONTACT_SORTS,
  NO_COMPANY,
  contactListSchema,
  createContactSchema,
  updateContactSchema,
} from "@/types/schemas/contacts";
import { SORT_DIRECTIONS, UNASSIGNED } from "@/types/schemas/records";

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
  createdAt: z.string(),
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
  company: z
    .object({
      id: z.string(),
      name: z.string(),
      domain: z.string().nullable(),
      industry: z.string().nullable(),
    })
    .nullable(),
  primaryContactOfCompany: z.boolean(),
  owner: personOutput.nullable(),
  enrichment,
  enrichmentError: z
    .string()
    .nullable()
    .describe("Why the research agent's last look failed."),
  queued: z.boolean().describe("The research agent has work on them due now."),
  fields: recordValuesOutput,
  brief: z
    .object({
      narrative: z.string().nullable(),
      currentRole: z.string().optional(),
      tenure: z.string().optional(),
      previousRoles: z.array(z.string()).optional(),
      seniority: z.string().optional(),
      function: z.string().optional(),
      location: z.string().optional(),
      score: z.number().describe("How well its sources back it, 0 to 1."),
      sourceUrl: z.string().nullable(),
      refreshedAt: z.string(),
    })
    .nullable()
    .describe("The research agent's brief on them."),
  facts: z
    .array(
      z.object({
        field: z.string(),
        value: z.string(),
        band: z.enum(FACT_BANDS).describe("How sure the agent is."),
        sourceUrl: z.string().nullable(),
      }),
    )
    .describe("What the research agent found and put on the record."),
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
      owner: personOutput.nullable(),
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
  threads: z.number().describe("The threads those emails are in."),
  lastReplyAt: z.string().nullable(),
  meetings: z.number().describe("Captured meetings with them."),
  nextMeeting: z
    .object({ title: z.string().nullable(), startsAt: z.string() })
    .nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

function details(
  contact: ContactDetail,
  fields: z.input<typeof recordValuesOutput>,
): z.input<typeof detailsOutput> {
  const { relationship, brief } = contact;
  return {
    ...contact,
    ...relationship,
    name: fullName(contact),
    primaryContactOfCompany: contact.isPrimaryContact,
    enrichment: contact.enrichmentStatus,
    fields,
    brief: brief ? { ...brief, ...brief.sections } : null,
    facts: contact.facts.filter((fact) => fact.status === "APPLIED"),
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
        owners: ownersInput.describe(
          `Only contacts these members own, by email or id; "${UNASSIGNED}" for contacts nobody owns.`,
        ),
        companyIds: contactListSchema.shape.company
          .unwrap()
          .optional()
          .describe(
            `Only contacts at these companies, by id; "${NO_COMPANY}" for contacts at no company.`,
          ),
        titles: contactListSchema.shape.title
          .unwrap()
          .optional()
          .describe("Only contacts with exactly these titles."),
        seniorities: contactListSchema.shape.seniority
          .unwrap()
          .optional()
          .describe("Only contacts at these seniorities, as get_contact says."),
        personas: contactListSchema.shape.persona
          .unwrap()
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
      // Only fills in the list's defaults: the input took each filter by the
      // list's own rules.
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
      "One contact in full: details, company, owner, custom fields, the research agent's state, brief, what it found and its suggestions waiting for a person, their deals and colleagues, and the mail and meetings captured with them.",
    risk: "read",
    input: z.object({ id: contactId }).strict(),
    output: detailsOutput,
    handler: async ({ id }, context) => {
      const [contact, fields] = await Promise.all([
        ContactService.getContact(context.organizationId, id),
        recordValues(context.organizationId, "CONTACT", id),
      ]);
      return details(contact, fields);
    },
  }),

  create_contact: crmTool({
    description:
      "Add a contact, with their custom field values if given. Their email must not belong to another live contact. Without a companyId, a work email files them under that domain's company, adding it if missing (free mail such as gmail.com files them nowhere). The research agent then looks them up.",
    risk: "write",
    input: createContactSchema
      .omit({ ownerId: true })
      .extend({
        companyId: companyId.optional(),
        ownerEmail: ownerEmail.optional(),
        fields: fieldValuesInput,
      })
      .strict(),
    output: contactRefOutput,
    handler: async ({ ownerEmail: email, fields, ...input }, context) =>
      ContactService.createContact(context.organizationId, {
        ...input,
        ownerId: email ? await memberId(context.organizationId, email) : null,
        fields:
          fields &&
          (await withMemberIds(context.organizationId, "CONTACT", fields)),
      }),
  }),

  update_contact: crmTool({
    description:
      "Change a contact's details and custom field values, in one write. Only what is given changes; an empty string clears a detail. A null companyId takes them off their company.",
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
        fields: fieldValuesInput,
      })
      .strict(),
    output: contactRefOutput,
    handler: async ({ ownerEmail: email, fields, ...input }, context) =>
      ContactService.updateContact(context.organizationId, {
        ...input,
        ownerId:
          email === undefined
            ? undefined
            : email && (await memberId(context.organizationId, email)),
        fields:
          fields &&
          (await withMemberIds(context.organizationId, "CONTACT", fields)),
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
