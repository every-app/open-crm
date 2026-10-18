import { z } from "zod";
import type { ErrorCode } from "@/shared/error-codes";
import { fieldFiltersSchema } from "@/types/schemas/fields";

// What every record list (companies, contacts, deals) and its bulk actions
// take. Each entity extends `listInputSchema` with its own sort keys and
// default sort.

/** Rows per list page, as the CRM's tables show them. */
export const LIST_PAGE_SIZE = 25;

/** The most records one bulk action takes: a page of selected rows. */
const MAX_BULK_IDS = 100;

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** The owner filter's value for records nobody owns. */
export const UNASSIGNED = "unassigned";

/** The most owners a list filters by at once. */
export const OWNER_FILTER_MAX = 20;

/**
 * The most values one of a list's own filters (industry, company, title…)
 * takes at once. Each binds a parameter; recordLists.test.ts holds the
 * fullest list to D1's 100.
 */
export const FACET_FILTER_MAX = 6;

/** A list filter on a column's values: rows with any of them. */
export const facetFilterSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(FACET_FILTER_MAX)
  .default([]);

/** The Activity filter: records something happened on in the last 7, 30 or 90 days. */
export const ACTIVITY_WINDOWS = ["7", "30", "90"] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];

/**
 * How many records in a list's scope (the live or archived ones its search
 * finds) have each value of each of its filters, by filter then value:
 * `owner`, the list's own filters, and `field:<key>` for its select and user
 * fields.
 */
export type FacetCounts = Record<string, Record<string, number>>;

export const listInputSchema = z.object({
  q: z.string().trim().max(200).default(""),
  /**
   * Owners' user ids, and `UNASSIGNED` for records nobody owns. Each binds a
   * parameter, so a list stays within D1's 100 with every other filter on.
   */
  owner: z.array(z.string().min(1)).max(OWNER_FILTER_MAX).default([]),
  /** The Archived view: archived records only. The default is live ones. */
  archived: z.boolean().default(false),
  /** Custom field filters, by field key. */
  fields: fieldFiltersSchema.default({}),
  dir: z.enum(SORT_DIRECTIONS).default("asc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(LIST_PAGE_SIZE),
});

export type ListInput = z.infer<typeof listInputSchema>;

export const recordIdSchema = z.object({ id: z.string().min(1) });

export const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BULK_IDS),
});

export const bulkOwnerSchema = bulkIdsSchema.extend({
  /** Null takes the records away from whoever owns them. */
  ownerId: z.string().min(1).nullable(),
});

/**
 * How a bulk action went. `error` is the code of the first record that
 * failed, for the client's copy; the rest of each failure stays in the logs.
 */
export type BulkResult = {
  requested: number;
  succeeded: number;
  failed: number;
  error: ErrorCode | null;
};
