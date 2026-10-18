import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { SearchService } from "@/server/features/search/services/SearchService";
import { RECORD_KINDS } from "@/shared/records";
import { QUICK_SEARCH_MIN_LENGTH } from "@/types/schemas/search";

export const searchTools = {
  search_records: crmTool({
    description:
      "Turn a name into an id: companies by name or domain, contacts by name or email, deals by name, case-insensitively. Up to 5 of each; archived ones left out.",
    risk: "read",
    input: z
      .object({
        query: z
          .string()
          .min(QUICK_SEARCH_MIN_LENGTH)
          .max(200)
          .describe("A name, a domain, an email, or part of one."),
      })
      .strict(),
    output: z.object({
      results: z.array(
        z.object({
          kind: z.enum(RECORD_KINDS),
          id: z.string(),
          name: z.string(),
          detail: z
            .string()
            .nullable()
            .describe(
              "A company's domain, a contact's company or email, a deal's company.",
            ),
        }),
      ),
    }),
    handler: async ({ query }, context) => {
      const { hits } = await SearchService.quick(context.organizationId, query);
      return {
        results: hits.map((hit) => ({ ...hit, name: hit.label })),
      };
    },
  }),
};
