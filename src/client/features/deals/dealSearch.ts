import { z } from "zod";
import {
  SHARED_FILTER_KEYS,
  listInputFromSearch,
  recordListSearchSchema,
} from "@/client/features/records/listSearch";
import { DEAL_STAGES } from "@/shared/crm-enums";
import {
  CLOSING_WINDOWS,
  DEAL_SORTS,
  type DealListInput,
} from "@/types/schemas/deals";

/** /deals: the shared list params, with the deals' sort keys and filters. */
export const dealListSearchSchema = recordListSearchSchema.extend({
  sort: z.enum(DEAL_SORTS).optional().catch(undefined),
  /** The pipeline or the outcomes; every deal when absent. */
  status: z.enum(["open", "closed"]).optional().catch(undefined),
  stage: z.array(z.enum(DEAL_STAGES)).optional().catch(undefined),
  closing: z.array(z.enum(CLOSING_WINDOWS)).optional().catch(undefined),
});

export type DealListSearch = z.infer<typeof dealListSearchSchema>;

/** The params the deals list filters by. */
export const DEAL_FILTER_KEYS = [
  ...SHARED_FILTER_KEYS,
  "status",
  "stage",
  "closing",
] as const;

/** Newest first, as the CRM lists deals. */
export function dealListInput(search: DealListSearch): DealListInput {
  return {
    ...listInputFromSearch(search, { sort: "createdAt", dir: "desc" }),
    status: search.status ?? "all",
    stage: search.stage ?? [],
    closing: search.closing ?? [],
  };
}
