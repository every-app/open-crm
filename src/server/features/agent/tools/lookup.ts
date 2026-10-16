import { tool } from "ai";
import { sortBy } from "remeda";
import { z } from "zod";
import { domainOf, isDerivedName, normalise } from "../lib/names";
import { AgentLookupRepository } from "../repositories/AgentLookupRepository";
import type { AgentToolContext, ToolGroup } from "./context";

// Finding records without a rep's help, ported from the CRM's search_crm,
// list_deals and list_outstanding_work. All free.

const RECORD_KINDS = ["contact", "company", "deal"] as const;

export const lookupTools: ToolGroup = (context) => ({
  search_crm: tool({
    description:
      "Find contacts, companies and deals by name, email address, domain or deal name — the way a person would search. Returns each match with its id, so you never have to ask a rep for one. Free. Use it whenever a question names a record you do not have the id for.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .describe(
          "A name, an email address, a domain, or part of one. 'Comp AI', 'marchetti', 'fernhill.com'.",
        ),
      kinds: z
        .array(z.enum(RECORD_KINDS))
        .optional()
        .describe("Narrow the search. Defaults to all three."),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    execute: async ({ query, kinds, limit }) => {
      const result = await searchCrm(
        context,
        query,
        kinds ?? [...RECORD_KINDS],
        limit,
      );
      return {
        ...result,
        note:
          result.total === 0
            ? "Nothing in the CRM matches. That is an answer: say so rather than asking the rep to search for you. Try a shorter or differently spelled term first — a surname alone often works where a full name does not."
            : result.total > 1
              ? "More than one match. If it is genuinely ambiguous, name the candidates and ask which — never ask for an id."
              : undefined,
      };
    },
  }),

  list_deals: tool({
    description:
      "List deals across the CRM with pipeline status and inactivity filters. Use this for broad requests such as all open deals, stale deals, deals untouched for a number of days, or a pipeline sweep. Results are oldest-touch first and paginated; continue with nextCursor while hasMore is true. Free.",
    inputSchema: z.object({
      status: z.enum(["open", "won", "lost", "all"]).default("open"),
      inactiveForDays: z
        .number()
        .int()
        .min(0)
        .max(3650)
        .optional()
        .describe(
          "Return deals whose last activity was at least this many days ago. Deals with no activity qualify once they are this old.",
        ),
      companyId: z.string().optional(),
      ownerId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }),
    execute: async (input) => {
      const now = new Date();
      const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
      const rows = await AgentLookupRepository.listDeals(
        context.organizationId,
        { ...input, offset },
        now,
      );
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      return {
        criteria: {
          status: input.status,
          inactiveForDays: input.inactiveForDays ?? null,
          companyId: input.companyId ?? null,
          ownerId: input.ownerId ?? null,
        },
        asOf: now.toISOString(),
        deals: page.map((row) => ({
          id: row.id,
          name: row.name,
          stage: row.stage,
          amount: row.amount,
          currency: row.currency,
          company: { id: row.companyId, name: row.companyName },
          owner: row.ownerId
            ? { id: row.ownerId, name: row.ownerName, email: row.ownerEmail }
            : null,
          createdAt: row.createdAt,
          lastActivityAt: row.lastActivityAt,
          daysSinceLastActivity: Math.max(
            0,
            Math.floor(
              (now.getTime() -
                new Date(row.lastActivityAt ?? row.createdAt).getTime()) /
                86_400_000,
            ),
          ),
          neverActive: row.lastActivityAt === null,
          expectedCloseDate: row.expectedCloseDate,
        })),
        hasMore,
        nextCursor: hasMore ? String(offset + input.limit) : null,
      };
    },
  }),

  list_outstanding_work: tool({
    description:
      "List CRM contacts with outstanding research: no real name yet, no background written, or socials never looked for. Each row says what is missing. Deciding what is worth doing, and in what order, is your job.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(25).default(10),
    }),
    execute: async ({ limit }) => {
      const rows = await AgentLookupRepository.contactsNeedingWork(
        context.organizationId,
        limit,
      );
      const contacts = rows.map((row) => ({
        id: row.id,
        fullName: [row.firstName, row.lastName].filter(Boolean).join(" "),
        email: row.email,
        title: row.title,
        companyName: row.companyName,
        companyDomain:
          row.companyDomain ?? (row.email ? domainOf(row.email) : null),
        linkedinUrl: row.linkedinUrl,
        needs: {
          identity: isDerivedName(row.email, row.firstName, row.lastName),
          brief: row.briefContactId === null,
          socials: row.socialsCheckedAt === null,
        },
      }));
      return { count: contacts.length, contacts };
    },
  }),
});

async function searchCrm(
  context: AgentToolContext,
  query: string,
  kinds: readonly (typeof RECORD_KINDS)[number][],
  limit: number,
) {
  const term = query.trim();
  if (term.length < 2) {
    return { query: term, contacts: [], companies: [], deals: [], total: 0 };
  }
  const email = term.includes("@") ? term.toLowerCase() : null;
  const domain = email ? domainOf(email) : bareDomain(term);
  // Bound the OR: D1 binds at most 100 parameters per statement.
  const words = term
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 6);
  const take = limit * 3;
  const { organizationId } = context;
  const [contacts, companies, deals] = await Promise.all([
    kinds.includes("contact")
      ? AgentLookupRepository.searchContacts(organizationId, {
          term,
          words,
          email,
          take,
        })
      : [],
    kinds.includes("company")
      ? AgentLookupRepository.searchCompanies(organizationId, {
          term,
          words,
          domain,
          take,
        })
      : [],
    kinds.includes("deal")
      ? AgentLookupRepository.searchDeals(organizationId, { term, words, take })
      : [],
  ]);
  const ranked = <T>(rows: T[], fields: (row: T) => string[]) =>
    sortBy(rows, [(row) => score(term, fields(row)), "desc"]).slice(0, limit);
  const contactHits = ranked(contacts, (row) => [
    [row.firstName, row.lastName].filter(Boolean).join(" "),
    row.email ?? "",
    row.companyName ?? "",
  ]).map((row) => ({
    kind: "contact" as const,
    id: row.id,
    name: [row.firstName, row.lastName].filter(Boolean).join(" "),
    title: row.title,
    email: row.email,
    company: row.companyId
      ? { id: row.companyId, name: row.companyName }
      : null,
    lastActivityAt: row.lastActivityAt,
  }));
  const companyHits = ranked(companies, (row) => [
    row.name,
    row.domain ?? "",
  ]).map((row) => ({ kind: "company" as const, ...row }));
  const dealHits = ranked(deals, (row) => [row.name, row.companyName]).map(
    (row) => ({
      kind: "deal" as const,
      id: row.id,
      name: row.name,
      stage: row.stage,
      amount: row.amount,
      currency: row.currency,
      company: { id: row.companyId, name: row.companyName },
    }),
  );
  return {
    query: term,
    contacts: contactHits,
    companies: companyHits,
    deals: dealHits,
    total: contactHits.length + companyHits.length + dealHits.length,
  };
}

/** How well `term` matches: exact, prefix, substring, then share of words. */
function score(term: string, fields: string[]): number {
  const needle = normalise(term);
  if (!needle) return 0;
  let best = 0;
  for (const field of fields) {
    const hay = normalise(field);
    if (!hay) continue;
    if (hay === needle) best = Math.max(best, 4);
    else if (hay.startsWith(needle)) best = Math.max(best, 3);
    else if (hay.includes(needle)) best = Math.max(best, 2);
  }
  if (best > 0) return best;
  const words = term
    .split(/\s+/)
    .map(normalise)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return 0;
  const hay = fields.map(normalise).join(" ");
  return words.filter((word) => hay.includes(word)).length / words.length;
}

function bareDomain(term: string): string | null {
  const candidate = term
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(candidate) ? candidate : null;
}
