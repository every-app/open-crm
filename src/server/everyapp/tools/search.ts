import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { SearchService } from "@/server/features/search/services/SearchService";
import { QUICK_SEARCH_MIN_LENGTH } from "@/types/schemas/search";

export const searchTools = {
  search_records: crmTool({
    description:
      "Find companies, contacts and deals by part of a name, case-insensitively: a company's name or domain, a contact's name or email, a deal's name. Up to 5 of each, archived ones left out. Use it to turn a name into an id.",
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
    handler: async ({ query }, context) => {
      const { hits } = await SearchService.quick(context.organizationId, query);
      return {
        results: hits.map((hit) => ({
          kind: hit.kind,
          id: hit.id,
          name: hit.label,
          detail: hit.detail,
        })),
      };
    },
  }),
};
