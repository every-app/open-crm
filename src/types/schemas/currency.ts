import { z } from "zod";
import { CURRENCY_CODES } from "@/shared/currency";

/**
 * A currency the CRM supports, trimmed and uppercased first. A three-letter
 * shape is not enough: `ZZZ` is three letters and no currency.
 */
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z.enum(CURRENCY_CODES, {
      error: "That is not a currency this CRM can convert.",
    }),
  );

export const setReportingCurrencySchema = z.object({
  currency: currencyCodeSchema,
});

export const setManualRateSchema = z.object({
  currency: currencyCodeSchema,
  // Units of the reporting currency one unit of `currency` buys.
  rate: z
    .number()
    .positive("A rate has to be greater than zero.")
    // What the CRM's rate column held; anything larger is a typo.
    .max(1_000_000_000, "That rate is too large."),
});

export const removeManualRateSchema = z.object({
  currency: currencyCodeSchema,
});

/** Settings → Currencies' rate form, as typed: the rate is still text. */
export const manualRateFormSchema = z.object({
  currency: z.string().min(1, "Pick a currency."),
  rate: z
    .string()
    .trim()
    .refine((value) => {
      const rate = Number(value);
      return Number.isFinite(rate) && rate > 0;
    }, "A rate has to be a number greater than zero."),
});
