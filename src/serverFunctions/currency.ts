import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  removeManualRateSchema,
  setManualRateSchema,
  setReportingCurrencySchema,
} from "@/types/schemas/currency";

export const getCurrencySettings = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    CurrencyService.getSettings(context.organizationId),
  );

export const setReportingCurrency = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setReportingCurrencySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return CurrencyService.setReportingCurrency(
      context.organizationId,
      data.currency,
    );
  });

export const setManualRate = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setManualRateSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return CurrencyService.setManualRate(
      context.organizationId,
      data.currency,
      data.rate,
    );
  });

export const removeManualRate = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(removeManualRateSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return CurrencyService.removeManualRate(
      context.organizationId,
      data.currency,
    );
  });

export const refreshRates = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return CurrencyService.refreshRates(context.organizationId);
  });
