import { z } from "zod";

// A top-up is whole dollars, $10–$99, as OpenSEO sells them.
const MIN_TOP_UP_USD = 10;
const MAX_TOP_UP_USD = 99;

export const topUpSchema = z.object({
  amountUsd: z.number().int().min(MIN_TOP_UP_USD).max(MAX_TOP_UP_USD),
});

/** Settings → Billing's Buy credits form, as typed: the dollars are text. */
export const topUpFormSchema = z.object({
  amount: z
    .string()
    .trim()
    .refine(
      (value) =>
        /^\d+$/.test(value) &&
        Number(value) >= MIN_TOP_UP_USD &&
        Number(value) <= MAX_TOP_UP_USD,
      "Enter between $10–$99.",
    ),
});
