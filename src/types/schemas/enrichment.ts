import { z } from "zod";
import {
  ENRICHMENT_KINDS,
  ENRICHMENT_PROVIDERS,
  ENRICHMENT_RUN_SIZE,
} from "@/shared/enrichment";

/** One run of a selection: the browser sends a larger one in several. */
export const enrichRecordsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(ENRICHMENT_RUN_SIZE),
});

export const setEnrichmentProviderSchema = z.object({
  kind: z.enum(ENRICHMENT_KINDS),
  provider: z.enum(ENRICHMENT_PROVIDERS),
});
