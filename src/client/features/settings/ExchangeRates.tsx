import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { useState } from "react";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import {
  SettingsCard,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import type { CurrencySettings } from "@/server/features/currency/services/CurrencyService";
import {
  refreshRates,
  removeManualRate,
  setManualRate,
} from "@/serverFunctions/currency";
import { CURRENCIES } from "@/shared/currency";
import { manualRateFormSchema } from "@/types/schemas/currency";

const formatRate = (rate: number) =>
  rate.toLocaleString("en-US", { maximumFractionDigits: 10 });

/**
 * Settings → Currencies' rates: fetched daily for everyone, and the
 * organization's own, which win. Owners and admins refresh them and enter
 * or remove their own.
 */
export function ExchangeRates({
  settings,
  canManage,
}: {
  settings: CurrencySettings;
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  // Rates convert deals, which moves totals well beyond this page.
  const invalidateAll = () => queryClient.invalidateQueries();

  const refresh = useMutation({
    mutationFn: () => refreshRates(),
    onSuccess: async () => {
      await invalidateAll();
      toast.success("Rates refreshed.");
    },
    onError: (error) => {
      toast.error(
        getErrorCode(error) === "UPSTREAM_UNAVAILABLE"
          ? "Could not reach open.er-api.com."
          : getStandardErrorMessage(error),
      );
    },
  });

  const remove = useMutation({
    mutationFn: (currency: string) => removeManualRate({ data: { currency } }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success("Rate removed.");
    },
  });

  const base = settings.reportingCurrency;

  return (
    <SettingsSection
      title="Exchange rates"
      action={
        canManage ? (
          <>
            <Button
              variant="outline"
              onClick={() => setAdding((value) => !value)}
            >
              {adding ? "Cancel" : "Add rate"}
            </Button>
            <Button
              variant="outline"
              pending={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              Refresh
            </Button>
          </>
        ) : null
      }
    >
      <SettingsCard>
        {canManage && adding ? (
          <div className="px-5 py-4">
            {/* Remounted per base, so it never offers the reporting currency. */}
            <ManualRateForm
              key={base}
              base={base}
              onSaved={() => setAdding(false)}
            />
          </div>
        ) : null}
        {settings.rates.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {settings.inUse.length > 0 &&
            settings.inUse.every((row) => row.currency === base)
              ? `All deals use ${base}. No conversion is needed.`
              : "Add a rate when you use another currency."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Currency</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">As of</TableHead>
                {canManage ? (
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.rates.map((rate) => (
                <TableRow key={rate.currency}>
                  <TableCell>
                    <span className="font-medium">{rate.currency}</span>
                    {rate.name ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {rate.name}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(rate.rate)}
                  </TableCell>
                  <TableCell>
                    {rate.source === "MANUAL" ? (
                      <Badge variant="warning">By hand</Badge>
                    ) : (
                      <Badge variant="success">Fetched</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <RelativeTime date={rate.asOf} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {rate.source === "MANUAL" ? (
                        <InlineConfirm
                          label={`Remove the ${rate.currency} rate entered by hand`}
                          pending={
                            remove.isPending &&
                            remove.variables === rate.currency
                          }
                          onConfirm={() => remove.mutate(rate.currency)}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>
      {/* The feed's free terms ask for this link wherever its rates show. */}
      {settings.rates.some((rate) => rate.source !== "MANUAL") ? (
        <p className="text-right text-xs text-muted-foreground">
          <a
            href="https://www.exchangerate-api.com"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            Rates By Exchange Rate API
          </a>
        </p>
      ) : null}
    </SettingsSection>
  );
}

/** A rate entered by hand: 1 unit of a currency = ? of the reporting one. */
function ManualRateForm({
  base,
  onSaved,
}: {
  base: string;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { currency: string; rate: number }) =>
      setManualRate({ data: input }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const currencies = CURRENCIES.filter(({ code }) => code !== base).map(
    ({ code, name }) => ({ value: code, label: `${code} · ${name}` }),
  );

  const defaultValues: { currency: string; rate: string } = {
    currency: currencies[0]?.value ?? "",
    rate: "",
  };
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: manualRateFormSchema },
    onSubmit: async ({ value, formApi }) => {
      await mutation.mutateAsync({
        currency: value.currency,
        rate: Number(value.rate),
      });
      formApi.reset();
      toast.success("Rate saved.");
      onSaved();
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <form.AppField name="currency">
            {(field) => (
              <field.SelectField label="Currency" items={currencies} />
            )}
          </form.AppField>
        </div>
        <div className="w-44">
          <form.Subscribe selector={(state) => state.values.currency}>
            {(currency) => (
              <form.AppField name="rate">
                {(field) => (
                  <field.TextField
                    label={`1 ${currency || "unit"} = ? ${base}`}
                    inputMode="decimal"
                    placeholder="1.09"
                    autoComplete="off"
                  />
                )}
              </form.AppField>
            )}
          </form.Subscribe>
        </div>
        <form.SubmitButton>Save</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
