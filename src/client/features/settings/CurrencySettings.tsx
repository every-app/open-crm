import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { ExchangeRates } from "@/client/features/settings/ExchangeRates";
import {
  currencySettingsQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import type { CurrencySettings as Settings } from "@/server/features/currency/services/CurrencyService";
import { setReportingCurrency } from "@/serverFunctions/currency";
import { CURRENCIES, type CurrencyCode } from "@/shared/currency";

/** Settings → Currencies: what money is reported in, and how it gets there. */
export function CurrencySettings() {
  const canManage = useCanManageWorkspace();
  const query = useQuery(currencySettingsQueryOptions());

  return (
    <SettingsPage
      title="Currencies"
      description="What your numbers are reported in, and how the other currencies get there."
    >
      <QueryState
        query={query}
        errorFallback="The currency settings could not be loaded."
      >
        {(settings) => (
          <>
            <ReportingCurrency
              current={settings.reportingCurrency}
              canManage={canManage}
            />
            <ExchangeRates settings={settings} canManage={canManage} />
            <CurrenciesInUse settings={settings} />
          </>
        )}
      </QueryState>
    </SettingsPage>
  );
}

const CURRENCY_ITEMS = CURRENCIES.map(({ code, name }) => ({
  value: code,
  label: `${code} · ${name}`,
}));

const RECONVERTS =
  "Changing this re-converts every deal at today's rates. Figures already reported will move.";

function ReportingCurrency({
  current,
  canManage,
}: {
  current: CurrencyCode;
  canManage: boolean;
}) {
  const id = useId();
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
    <SettingsSection
      title="Reporting currency"
      description="Every total, chart and average in the CRM is expressed in this currency. Each deal keeps the currency it was sold in."
    >
      <SettingsCard>
        <SettingsRow
          label="Report totals in"
          htmlFor={id}
          description={
            canManage
              ? RECONVERTS
              : "Only an owner or an admin can change how money is reported."
          }
        >
          <Select
            items={CURRENCY_ITEMS}
            value={current}
            disabled={!canManage}
            onValueChange={(value) => {
              if (value && value !== current) setNext(value);
            }}
          >
            <SelectTrigger id={id} className="w-full sm:w-72">
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
        </SettingsRow>
      </SettingsCard>
      {next ? (
        <ConfirmDialog
          title={`Report totals in ${next}?`}
          confirmLabel={`Report in ${next}`}
          pending={mutation.isPending}
          onClose={() => setNext(null)}
          onConfirm={() => mutation.mutate(next)}
        >
          {RECONVERTS}
        </ConfirmDialog>
      ) : null}
    </SettingsSection>
  );
}

function CurrenciesInUse({ settings }: { settings: Settings }) {
  const { unconverted, inUse, reportingCurrency, refreshedAt } = settings;
  const deals = `${unconverted.count} ${unconverted.count === 1 ? "deal" : "deals"}`;

  return (
    <SettingsSection
      title="Currencies in use"
      description={
        <>
          {unconverted.count === 0
            ? "Every deal with an amount can be converted into the reporting currency."
            : `${deals} cannot be converted, so ${unconverted.count === 1 ? "it is" : "they are"} left out of every total.`}
          {refreshedAt ? (
            <>
              {" "}
              Rates last fetched <RelativeTime date={refreshedAt} />.
            </>
          ) : null}
        </>
      }
    >
      <SettingsCard>
        {inUse.length === 0 ? (
          <EmptyState
            icon={Banknote}
            media="rows"
            variant="plain"
            title="No deals have an amount yet"
          />
        ) : (
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
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
