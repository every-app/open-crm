import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/client/components/ui/field";
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
  TableCard,
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

/** A labelled switch for one tracking setting. */
export function SettingSwitch({
  label,
  hint,
  checked,
  pending,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  pending: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" data-disabled={pending}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{hint}</FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        disabled={pending}
        onCheckedChange={onChange}
      />
    </Field>
  );
}

const RULES = [
  {
    flag: "crossDomain",
    label: "Automatic cross-domain linking",
    hint: "Carry a visitor between your allowed domains, so one journey is not counted as two people.",
  },
  {
    flag: "limitToDomains",
    label: "Limit tracking to the allowed domains",
    hint: "On any other domain the script loads and then does nothing.",
  },
] as const;

const COOKIE_SWITCHES = [
  {
    flag: "cookieSubdomains",
    label: "Limit cookies to subdomains",
    hint: "Set the cookie on the exact host that served the page, never on the parent domain.",
  },
  {
    flag: "secureCookies",
    label: "Use secure cookies only",
    hint: "Send the cookie over HTTPS and drop it on plain HTTP.",
  },
  {
    flag: "honourDnt",
    label: "Honour Do Not Track",
    hint: "Record nothing when the browser asks not to be tracked.",
  },
] as const;

function FlagSwitches({
  settings,
  switches,
}: {
  settings: TrackingSettings;
  switches: readonly { flag: TrackingFlag; label: string; hint: string }[];
}) {
  const setFlag = useTrackingMutation(
    (input: { flag: TrackingFlag; enabled: boolean }) =>
      setTrackingFlag({ data: input }),
  );
  return (
    <div className="space-y-4">
      {switches.map((entry) => (
        <SettingSwitch
          key={entry.flag}
          label={entry.label}
          hint={entry.hint}
          checked={settings[entry.flag]}
          pending={setFlag.isPending}
          onChange={(enabled) => setFlag.mutate({ flag: entry.flag, enabled })}
        />
      ))}
    </div>
  );
}

/** Where the script may run, and how it follows a visitor. */
export function TrackingRules({ settings }: { settings: TrackingSettings }) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Tracking rules" />
      <FlagSwitches settings={settings} switches={RULES} />
    </section>
  );
}

const LIFETIME_ITEMS = COOKIE_LIFETIMES.map(({ days, label }) => ({
  value: String(days),
  label,
}));

/** How a returning visitor is recognised. */
export function TrackingCookies({ settings }: { settings: TrackingSettings }) {
  const lifetimeId = useId();
  const setLifetime = useTrackingMutation(
    (days: number) => setTrackingCookieLifetime({ data: { days } }),
    () => toast.success("Cookie lifetime saved"),
  );
  return (
    <section className="space-y-3">
      <SectionHeader title="Cookies" />
      <FlagSwitches settings={settings} switches={COOKIE_SWITCHES} />
      <Field className="max-w-sm" data-disabled={setLifetime.isPending}>
        <FieldLabel htmlFor={lifetimeId}>Cookie lifetime</FieldLabel>
        <Select
          items={LIFETIME_ITEMS}
          value={String(settings.cookieDays)}
          disabled={setLifetime.isPending}
          onValueChange={(value) => {
            if (value !== null) setLifetime.mutate(Number(value));
          }}
        >
          <SelectTrigger id={lifetimeId} className="w-full">
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
        <FieldDescription>
          After this a returning visitor counts as somebody new. Shorten it if
          your privacy policy asks you to.
        </FieldDescription>
      </Field>
    </section>
  );
}

/** Where visitors come from, and the contacts each source brought in. */
export function TrafficSources() {
  const query = useQuery(trafficSourcesQueryOptions());
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Traffic sources"
        hint="Only people who have submitted a form are attributed to a contact."
      />
      <QueryState
        query={query}
        errorFallback="The traffic sources could not be loaded."
      >
        {(sources) =>
          sources.length === 0 ? (
            <EmptyState
              title="No sources yet"
              description="They appear once the script records its first page view."
              size="sm"
            />
          ) : (
            <TableCard>
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
                      <TableCell className="font-medium">
                        {row.source}
                      </TableCell>
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
            </TableCard>
          )
        }
      </QueryState>
    </section>
  );
}
