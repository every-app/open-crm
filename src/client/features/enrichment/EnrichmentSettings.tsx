import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unique } from "remeda";
import { QueryError } from "@/client/components/QueryState";
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
import { Skeleton } from "@/client/components/ui/skeleton";
import { enrichmentSettingsQueryOptions } from "@/client/features/enrichment/enrichmentQueries";
import { CodeBlock } from "@/client/features/settings/CodeBlock";
import { ConnectionBadge } from "@/client/features/settings/ConnectionStatus";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { setEnrichmentProvider } from "@/serverFunctions/enrichment";
import {
  ENRICHMENT_PROVIDERS,
  ENRICHMENT_PROVIDER_NAMES,
  type EnrichmentKind,
  type EnrichmentProvider,
  type EnrichmentSettings as Settings,
} from "@/shared/enrichment";

/** What each provider brings: the difference a workspace chooses between. */
const BRINGS = {
  context:
    "Titles and profiles, company details, and the photos and logos Treg doesn't have.",
  treg: "Titles, profiles and company details from many data vendors, paid per lookup. No photos or logos.",
} as const satisfies Record<EnrichmentProvider, string>;

const CHOICES = [
  { kind: "contact", label: "Enrich contacts with" },
  { kind: "company", label: "Enrich companies with" },
] as const satisfies readonly { kind: EnrichmentKind; label: string }[];

const PROVIDER_ITEMS = ENRICHMENT_PROVIDERS.map((provider) => ({
  value: provider,
  label: ENRICHMENT_PROVIDER_NAMES[provider],
}));

/**
 * Settings → Connections → Enrichment: the two providers and whether each is
 * set up, and, once both are, which one contacts and companies use.
 */
export function EnrichmentSettings() {
  const query = useQuery(enrichmentSettingsQueryOptions());
  const canManage = useCanManageWorkspace();
  const settings = query.data;
  const bothReady = settings?.providers.every((status) => status.ready);
  // What sets a missing provider up, once: both name the same command.
  const commands = unique(
    (settings?.providers ?? []).flatMap((status) =>
      status.command ? [status.command] : [],
    ),
  );

  return (
    <SettingsSection
      title="Enrichment"
      description="Select contacts or companies in a list and choose Enrich to fill in what they are missing. Nothing is looked up until someone asks."
    >
      {query.isError ? (
        <QueryError
          error={query.error}
          fallback="The enrichment providers could not be loaded."
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : (
        <SettingsCard>
          {ENRICHMENT_PROVIDERS.map((provider) => {
            const status = settings?.providers.find(
              (entry) => entry.provider === provider,
            );
            return (
              <SettingsRow
                key={provider}
                label={ENRICHMENT_PROVIDER_NAMES[provider]}
                description={
                  <>
                    {BRINGS[provider]}
                    {/* What is missing, in the gateway's words, for whoever can set it. */}
                    {canManage && status?.setup ? (
                      <span className="mt-1 block">{status.setup}</span>
                    ) : null}
                  </>
                }
              >
                {status ? (
                  <ConnectionBadge
                    state={status.ready ? "connected" : "unconfigured"}
                  />
                ) : (
                  <Skeleton className="h-5 w-24" />
                )}
              </SettingsRow>
            );
          })}
          {settings && bothReady
            ? CHOICES.map((choice) => (
                <ProviderChoice
                  key={choice.kind}
                  {...choice}
                  settings={settings}
                  canManage={canManage}
                />
              ))
            : null}
          {canManage && commands.length > 0 ? (
            <SettingsRow
              stacked
              label="Set a provider up"
              description="Run this where the CRM is deployed. It asks for the provider's key and keeps it on the Every App gateway."
            >
              {commands.map((command) => (
                <CodeBlock key={command} value={command} />
              ))}
            </SettingsRow>
          ) : null}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

function ProviderChoice({
  kind,
  label,
  settings,
  canManage,
}: {
  kind: EnrichmentKind;
  label: string;
  settings: Settings;
  canManage: boolean;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (provider: EnrichmentProvider) =>
      setEnrichmentProvider({ data: { kind, provider } }),
    onSuccess: (next) =>
      queryClient.setQueryData(enrichmentSettingsQueryOptions().queryKey, next),
  });
  return (
    <SettingsRow label={label} htmlFor={id}>
      <Select
        items={PROVIDER_ITEMS}
        value={mutation.isPending ? mutation.variables : settings.active[kind]}
        disabled={!canManage || mutation.isPending}
        onValueChange={(value) => {
          if (value !== null) mutation.mutate(value);
        }}
      >
        <SelectTrigger id={id} className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDER_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
