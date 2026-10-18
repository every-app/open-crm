import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Signpost } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  trafficSourcesQueryOptions,
  useTrackingMutation,
} from "@/client/features/tracking/trackingQueries";
import type { TrackingSettings } from "@/server/features/tracking/services/TrackingSettingsService";
import {
  setTrackingCookieLifetime,
  setTrackingFlag,
} from "@/serverFunctions/tracking";
import { COOKIE_LIFETIMES, type TrackingFlag } from "@/shared/tracking";

/** One tracking setting as a settings row with its switch. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <SettingsRow label={label} htmlFor={id} description={hint}>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </SettingsRow>
  );
}

/** The rules, which name the domains as above or below them on the page. */
function rules(where: "above" | "below") {
  return [
    { flag: "crossDomain", label: "Automatic cross-domain linking" },
    { flag: "limitToDomains", label: `Limit tracking to the domains ${where}` },
  ] as const;
}

const COOKIE_SWITCHES = [
  { flag: "cookieSubdomains", label: "Limit cookies to subdomains" },
  { flag: "secureCookies", label: "Use secure cookies only" },
  { flag: "honourDnt", label: "Honour Do Not Track" },
] as const;

function useSetFlag() {
  return useTrackingMutation(
    (input: { flag: TrackingFlag; enabled: boolean }) =>
      setTrackingFlag({ data: input }),
  );
}

/**
 * Where the script may run, and how it follows a visitor. Until tracking is
 * ready the domains come first on the page, as adding one is the first step.
 */
export function TrackingRules({
  settings,
  canManage,
}: {
  settings: TrackingSettings;
  canManage: boolean;
}) {
  const setFlag = useSetFlag();
  return (
    <SettingsSection title="Tracking rules">
      <SettingsCard>
        {rules(settings.ready ? "below" : "above").map((rule) => (
          <SwitchRow
            key={rule.flag}
            label={rule.label}
            checked={settings[rule.flag]}
            disabled={!canManage || setFlag.isPending}
            onChange={(enabled) => setFlag.mutate({ flag: rule.flag, enabled })}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

const LIFETIME_ITEMS = COOKIE_LIFETIMES.map(({ days, label }) => ({
  value: String(days),
  label,
}));

/** How a returning visitor is recognised. */
export function TrackingCookies({
  settings,
  canManage,
}: {
  settings: TrackingSettings;
  canManage: boolean;
}) {
  const lifetimeId = useId();
  const setFlag = useSetFlag();
  const setLifetime = useTrackingMutation(
    (days: number) => setTrackingCookieLifetime({ data: { days } }),
    () => toast.success("Cookie lifetime saved."),
  );
  const busy = !canManage || setFlag.isPending || setLifetime.isPending;
  return (
    <SettingsSection title="Cookies">
      <SettingsCard>
        {COOKIE_SWITCHES.map((entry) => (
          <SwitchRow
            key={entry.flag}
            label={entry.label}
            checked={settings[entry.flag]}
            disabled={busy}
            onChange={(enabled) =>
              setFlag.mutate({ flag: entry.flag, enabled })
            }
          />
        ))}
        <SettingsRow label="Cookie lifetime" htmlFor={lifetimeId}>
          <Select
            items={LIFETIME_ITEMS}
            value={String(settings.cookieDays)}
            disabled={busy}
            onValueChange={(value) => {
              if (value !== null) setLifetime.mutate(Number(value));
            }}
          >
            <SelectTrigger id={lifetimeId} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIFETIME_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

/** Where visitors come from, and the contacts each source brought in. */
export function TrafficSources() {
  const query = useQuery(trafficSourcesQueryOptions());
  return (
    <SettingsSection title="Traffic sources">
      <QueryState
        query={query}
        errorFallback="The traffic sources could not be loaded."
      >
        {(sources) => (
          <SettingsCard>
            {sources.length === 0 ? (
              <EmptyState
                icon={Signpost}
                media="rows"
                variant="plain"
                title="No sources yet"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Medium</TableHead>
                    <TableHead className="text-right">Page views</TableHead>
                    <TableHead className="text-right">Contacts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((row) => (
                    <TableRow key={`${row.source}|${row.medium ?? ""}`}>
                      <TableCell>{row.source}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.medium ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.views.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.contacts.toLocaleString("en-US")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SettingsCard>
        )}
      </QueryState>
    </SettingsSection>
  );
}
