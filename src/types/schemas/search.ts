import { z } from "zod";

/** Shorter searches match too much to be worth a round trip. */
export const QUICK_SEARCH_MIN_LENGTH = 2;

export const quickSearchSchema = z.object({
  q: z.string().max(200).default(""),
});
