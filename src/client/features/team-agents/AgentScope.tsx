import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  captureGrants,
  recordResources,
  type AgentManifest,
  type CaptureKind,
  type RecordResource,
} from "@/shared/team-agents";
import { SaveFooter, useRevise } from "./agentEditing";
import { builderResourcesQueryOptions } from "./teamAgentQueries";

const KIND_LABELS = {
  company: "Company",
  contact: "Contact",
  deal: "Deal",
} as const;

const CAPTURED_LABELS: Record<CaptureKind, string> = {
  email: "Captured email",
  calendar: "Captured meetings",
};

const recordKey = (record: { kind: string; id: string }) =>
  `${record.kind}:${record.id}`;

/**
 * What the deployed version reads (the CRM's "What it can see"): its records
 * and the captured email and meetings. Taking one away goes live at once;
 * adding one makes a version to review and deploy.
 */
export function AgentScope({
  agentId,
  manifest,
  canManage,
}: {
  agentId: string;
  manifest: AgentManifest;
  canManage: boolean;
}) {
  const scope = recordResources(manifest.dataScope.resources);
  const granted = captureGrants(manifest.dataScope.resources);
  const [records, setRecords] = useState<RecordResource[] | null>(null);
  const [sources, setSources] = useState<CaptureKind[] | null>(null);
  const shownRecords = records ?? scope;
  const shownSources = sources ?? CAPTURE_KINDS.filter((kind) => granted[kind]);
  const reset = () => {
    setRecords(null);
    setSources(null);
  };
  const revise = useRevise(agentId, reset);
  const workspace = manifest.dataScope.mode === "WORKSPACE";
  const dirty = records !== null || sources !== null;
  const had = new Set(scope.map(recordKey));
  const widens =
    shownRecords.some((record) => !had.has(recordKey(record))) ||
    shownSources.some((kind) => !granted[kind]);
  const blocked =
    records !== null && !workspace && records.length === 0
      ? "Add one record. An empty list opens every record in the workspace."
      : null;
  const remove = (label: string, onClick: () => void) =>
    canManage ? (
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Remove ${label}`}
        disabled={revise.isPending}
        onClick={onClick}
      >
        <X />
      </Button>
    ) : null;

  return (
    <SettingsSection
      title="What it can see"
      description="What it reads to do its job."
      action={
        canManage ? (
          <RecordTypePicker
            workspace={workspace}
            taken={
              new Set([
                ...shownRecords.map(recordKey),
                ...shownSources.map(
                  (kind) => `integration:${CAPTURE_GRANTS[kind].resource.id}`,
                ),
              ])
            }
            onRecord={(record) => setRecords([...shownRecords, record])}
            onSource={(kind) => setSources([...shownSources, kind])}
          />
        ) : null
      }
    >
      <SettingsCard>
        {workspace ? (
          <SettingsRow label="Every record in the workspace" />
        ) : null}
        {shownRecords.map((record) => (
          <SettingsRow
            key={recordKey(record)}
            label={record.label}
            description={KIND_LABELS[record.kind]}
          >
            {remove(record.label, () =>
              setRecords(shownRecords.filter((entry) => entry !== record)),
            )}
          </SettingsRow>
        ))}
        {shownSources.map((kind) => (
          <SettingsRow
            key={kind}
            label={CAPTURED_LABELS[kind]}
            description={CAPTURE_GRANTS[kind].access}
          >
            {remove(CAPTURED_LABELS[kind], () =>
              setSources(shownSources.filter((entry) => entry !== kind)),
            )}
          </SettingsRow>
        ))}
        {canManage ? (
          <SaveFooter
            note={
              blocked ??
              (widens
                ? "Added access waits for review before it runs."
                : dirty
                  ? "The old version stays in the history."
                  : null)
            }
            dirty={dirty}
            blocked={blocked !== null}
            pending={revise.isPending}
            onDiscard={reset}
            onSave={() =>
              revise.mutate({
                resources: records ?? undefined,
                sources: sources ?? undefined,
              })
            }
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

/**
 * The records it could read too, and the captured email and meetings (the
 * CRM's "Add a record type"). A workspace-wide agent already reads every
 * record.
 */
function RecordTypePicker({
  workspace,
  taken,
  onRecord,
  onSource,
}: {
  workspace: boolean;
  taken: Set<string>;
  onRecord: (record: RecordResource) => void;
  onSource: (kind: CaptureKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useQuery({
    ...builderResourcesQueryOptions(query),
    enabled: open,
  });
  const sourceOf = (id: string) =>
    CAPTURE_KINDS.find((kind) => CAPTURE_GRANTS[kind].resource.id === id);
  const options = (results.data ?? []).filter(
    (resource) =>
      !taken.has(recordKey(resource)) &&
      (resource.kind === "integration"
        ? sourceOf(resource.id) !== undefined
        : !workspace),
  );
  const pick = (resource: (typeof options)[number]) => {
    const kind = sourceOf(resource.id);
    if (resource.kind !== "integration") {
      onRecord({ kind: resource.kind, id: resource.id, label: resource.label });
    } else if (kind) {
      onSource(kind);
    }
    setOpen(false);
    setQuery("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Plus data-icon="inline-start" />
        Add a record type
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records and integrations"
            aria-label="Search records and integrations"
          />
        </div>
        <div className="flex max-h-64 flex-col overflow-y-auto py-1">
          {options.map((resource) => {
            const kind = sourceOf(resource.id);
            return (
              <Button
                key={recordKey(resource)}
                variant="ghost"
                className="h-auto flex-col items-start rounded-none px-3 py-2 text-left font-normal whitespace-normal"
                disabled={resource.unavailable !== null}
                onClick={() => pick(resource)}
              >
                <span className="text-sm">
                  {kind ? CAPTURED_LABELS[kind] : resource.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {resource.unavailable ??
                    (resource.kind === "integration"
                      ? resource.detail
                      : [KIND_LABELS[resource.kind], resource.detail]
                          .filter(Boolean)
                          .join(" · "))}
                </span>
              </Button>
            );
          })}
          {results.data && options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nothing matches.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
