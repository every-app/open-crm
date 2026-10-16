import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { ExchangeRates } from "@/client/features/settings/ExchangeRates";
import {
  currencySettingsQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import type { CurrencySettings as Settings } from "@/server/features/currency/services/CurrencyService";
import { setReportingCurrency } from "@/serverFunctions/currency";
import { CURRENCIES, currencyName, type CurrencyCode } from "@/shared/currency";

/** Settings → Currencies: what money is reported in, and how it gets there. */
export function CurrencySettings() {
  const canManage = useCanManageWorkspace();
  const query = useQuery(currencySettingsQueryOptions());

  return (
    <QueryState
      query={query}
      errorFallback="The currency settings could not be loaded."
    >
      {(settings) => (
        <div className="space-y-10">
          <ReportingCurrency
            current={settings.reportingCurrency}
            canManage={canManage}
          />
          <ExchangeRates settings={settings} canManage={canManage} />
          <CurrenciesInUse settings={settings} />
        </div>
      )}
    </QueryState>
  );
}

const CURRENCY_ITEMS = CURRENCIES.map(({ code, name }) => ({
  value: code,
  label: `${code} · ${name}`,
}));

function ReportingCurrency({
  current,
  canManage,
}: {
  current: CurrencyCode;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  // The currency picked, until the change is confirmed or dismissed.
  const [next, setNext] = useState<CurrencyCode | null>(null);
  const mutation = useMutation({
    mutationFn: (currency: CurrencyCode) =>
      setReportingCurrency({ data: { currency } }),
    onSuccess: async (settings) => {
      // Every deal total moves, not only this page's.
      await queryClient.invalidateQueries();
      toast.success(
        `Every total is now reported in ${settings.reportingCurrency}.`,
      );
    },
    onSettled: () => setNext(null),
  });

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Reporting currency"
        hint={
          canManage
            ? undefined
            : "Only an owner or an admin can change how money is reported."
        }
      />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Every total, chart and average in the CRM is in this currency. Each deal
        keeps the currency it was sold in.
      </p>
      {canManage ? (
        <Select
          items={CURRENCY_ITEMS}
          value={current}
          onValueChange={(value) => {
            if (value && value !== current) setNext(value);
          }}
        >
          <SelectTrigger
            className="w-full max-w-sm"
            aria-label="Report totals in"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCY_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-sm font-medium">
          {current} · {currencyName(current)}
        </p>
      )}
      {next ? (
        <ConfirmDialog
          title={`Report totals in ${next}?`}
          confirmLabel={`Report in ${next}`}
          pending={mutation.isPending}
          onClose={() => setNext(null)}
          onConfirm={() => mutation.mutate(next)}
        >
          Every deal is converted again at today&apos;s rates, so figures
          already reported will move. Deals in a currency with no rate drop out
          of totals until one is entered.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function CurrenciesInUse({ settings }: { settings: Settings }) {
  const { unconverted, inUse, reportingCurrency } = settings;
  const deals = `${unconverted.count} ${unconverted.count === 1 ? "deal" : "deals"}`;

  return (
    <section className="space-y-3">
      <SectionHeader title="Currencies in use" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        {unconverted.count === 0
          ? "Every deal with an amount can be converted into the reporting currency."
          : `${deals} in ${unconverted.currencies.join(", ")} cannot be converted, so ${unconverted.count === 1 ? "it is" : "they are"} left out of every total.`}
      </p>
      {inUse.length === 0 ? (
        <EmptyState title="No deals have an amount yet" size="sm" />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Currency</TableHead>
                <TableHead className="text-right">Deals</TableHead>
                <TableHead className="text-right">Convertible</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inUse.map((row) => (
                <TableRow key={row.currency}>
                  <TableCell>
                    <span className="font-medium">{row.currency}</span>
                    <span className="text-muted-foreground">
                      {row.name ? ` · ${row.name}` : ""}
                      {row.currency === reportingCurrency
                        ? " · reporting currency"
                        : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.deals.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.convertible ? (
                      <Badge variant="success">Yes</Badge>
                    ) : (
                      <Badge variant="destructive">No rate</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  );
}
