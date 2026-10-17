import { tool } from "ai";
import { z } from "zod";
import { AgentAccountRepository } from "../repositories/AgentAccountRepository";
import { AgentHistoryRepository } from "../repositories/AgentHistoryRepository";
import { AgentDealRepository } from "../repositories/AgentDealRepository";
import type { ToolGroup } from "./context";

// The free CRM reads, ported from the CRM's read_crm_history,
// read_company_history and read_deal_history. Every read hands back the ids
// of the neighbouring records, so the agent never has to ask a rep for one.

const threads = z
  .number()
  .int()
  .min(1)
  .max(20)
  .default(5)
  .describe("How many recent threads to read.");

export const historyTools: ToolGroup = (context) => ({
  read_crm_history: tool({
    description:
      "Read everything the CRM already has on a contact: email threads with full message bodies, meetings, whether they have ever replied, their company and its id, the deals they are on, and who else we know at their company. Free, fast, and the best evidence there is — call it before paying for a lookup.",
    inputSchema: z.object({ contactId: z.string(), threads }),
    execute: async ({ contactId, threads: threadCount }) => {
      const history = await AgentHistoryRepository.contactHistory(
        context.organizationId,
        contactId,
        { threads: threadCount },
      );
      if (!history)
        return { found: false as const, reason: "No such contact." };
      const evidence =
        history.stats.emails === 0 && history.stats.meetings === 0
          ? "We have never actually spoken to this person. Nothing here is evidence of anything."
          : "A signature block or a reply from their own address is primary evidence — record it as `crm.signature-block` or `crm.thread-reply`.";
      const reach = history.contact.company
        ? ` Their company is \`${history.contact.company.id}\` — read_company_history or enrich_company take that id directly.`
        : " They are not attached to a company; search_crm will find one by name or domain if the question needs it.";
      return { found: true as const, ...history, note: evidence + reach };
    },
  }),

  read_company_history: tool({
    description:
      "Read everything the CRM has on a company: every contact there with their id, title and whether we have heard from them; every deal with stage and value; recent email threads with full bodies; meetings; and notes. Free and fast — call it first in a company session, and whenever you need to find a person at a company you already know.",
    inputSchema: z.object({
      companyId: z.string(),
      threads: threads.describe(
        "How many recent threads to read across the whole account.",
      ),
      people: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe("How many contacts to list."),
    }),
    execute: async ({ companyId, threads: threadCount, people }) => {
      const history = await AgentAccountRepository.companyHistory(
        context.organizationId,
        companyId,
        { threads: threadCount, people },
      );
      if (!history)
        return { found: false as const, reason: "No such company." };
      return {
        found: true as const,
        ...history,
        note:
          history.people.length === 0
            ? "We have no contacts on file at this company, so there is nobody here to research yet."
            : "Every person above carries their contact id — use it directly with read_crm_history, identify_contact or record_fact. Never ask a rep for an id that is in this list.",
      };
    },
  }),

  read_deal_history: tool({
    description:
      "Read a deal in full: stage and how long it has been there, value, close date, the whole stage history, who is on it with their contact ids, the correspondence and meetings with those people, and the notes. Free — call it first in a deal session.",
    inputSchema: z.object({ dealId: z.string(), threads }),
    execute: async ({ dealId, threads: threadCount }) => {
      const history = await AgentDealRepository.dealHistory(
        context.organizationId,
        dealId,
        { threads: threadCount },
      );
      if (!history) return { found: false as const, reason: "No such deal." };
      return { found: true as const, ...history };
    },
  }),
});
