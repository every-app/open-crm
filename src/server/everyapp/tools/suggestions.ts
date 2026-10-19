import { z } from "zod";
import { crmTool, fullName, pageInput } from "@/server/everyapp/crm-tool";
import { ContactFactService } from "@/server/features/contacts/services/ContactFactService";
import { FACT_BANDS } from "@/shared/crm-enums";
import { decideFactSchema } from "@/types/schemas/contacts";

// What the research agent found about contacts that waits for a person: a
// value that would replace one the contact already has, offered with the
// evidence behind it. Accepting writes it on the contact; dismissing keeps
// it from being offered again.

export const suggestionOutput = z.object({
  id: z
    .string()
    .describe("decide_contact_suggestion takes it to accept or dismiss."),
  field: z.string(),
  value: z.string(),
  band: z.enum(FACT_BANDS).describe("How sure the agent is."),
  why: z.array(z.string()),
  sourceUrl: z.string().nullable(),
});

const SUGGESTIONS_PAGE = 25;

const contactId = z
  .string()
  .min(1)
  .describe("The contact's id, from list_contacts or search_records.");

export const suggestionTools = {
  list_contact_suggestions: crmTool({
    description:
      "What the research agent found about contacts that waits for a person: a new name, title, seniority, function or profile link that would replace what the contact has. Every live contact's, or one's. 25 a page, newest first.",
    risk: "read",
    input: z
      .object({
        contactId: contactId.optional().describe("Only this contact's."),
        page: pageInput,
      })
      .strict(),
    output: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      suggestions: z.array(
        suggestionOutput.extend({
          contact: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string().nullable(),
          }),
          observedAt: z.string(),
        }),
      ),
    }),
    handler: async (input, context) => {
      const page = input.page ?? 1;
      const { rows, total } = await ContactFactService.listSuggestions(
        context.organizationId,
        { contactId: input.contactId, page, pageSize: SUGGESTIONS_PAGE },
      );
      return {
        total,
        page,
        pageSize: SUGGESTIONS_PAGE,
        suggestions: rows.map((row) => ({
          ...row,
          why: row.evidence.map((item) => item.detail),
          contact: { id: row.contactId, name: fullName(row), email: row.email },
        })),
      };
    },
  }),

  decide_contact_suggestion: crmTool({
    description:
      "Accept a research agent suggestion, which writes its value on the contact, or dismiss it, so it is never offered again.",
    risk: "write",
    input: z
      .object({
        id: decideFactSchema.shape.factId.describe(
          "The suggestion's id, from list_contact_suggestions or get_contact.",
        ),
        decision: decideFactSchema.shape.decision,
      })
      .strict(),
    output: z.object({
      contactId: z.string(),
      field: z.string(),
      applied: z.boolean().describe("The value is on the contact now."),
    }),
    handler: ({ id, decision }, context) =>
      ContactFactService.decideFact(context.organizationId, context.userId, {
        factId: id,
        decision,
      }),
  }),
};
