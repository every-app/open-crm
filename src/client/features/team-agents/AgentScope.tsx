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
  type CaptureKind,
  type RecordResource,
} from "@/shared/team-agents";
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

export const recordKey = (record: { kind: string; id: string }) =>
  `${record.kind}:${record.id}`;

/**
 * What the deployed version reads (the CRM's "What it can see"): its records
 * and the captured email and meetings, as the page's unsaved changes have
 * them.
 */
export function AgentScope({
  workspace,
  records,
  sources,
  canManage,
  disabled,
  onRecords,
  onSources,
}: {
  /** It reads every record in the workspace. */
  workspace: boolean;
  records: RecordResource[];
  sources: CaptureKind[];
  canManage: boolean;
  disabled: boolean;
  onRecords: (records: RecordResource[]) => void;
  onSources: (sources: CaptureKind[]) => void;
}) {
  const remove = (label: string, onClick: () => void) =>
    canManage ? (
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={onClick}
      >
        <X />
      </Button>
    ) : null;

  return (
    <SettingsSection
      title="What it can see"
      action={
        canManage ? (
          <RecordTypePicker
            workspace={workspace}
            taken={
              new Set([
                ...records.map(recordKey),
                ...sources.map(
                  (kind) => `integration:${CAPTURE_GRANTS[kind].resource.id}`,
                ),
              ])
            }
            onRecord={(record) => onRecords([...records, record])}
            onSource={(kind) => onSources([...sources, kind])}
          />
        ) : null
      }
    >
      <SettingsCard>
        {workspace ? (
          <SettingsRow label="Every record in the workspace" />
        ) : null}
        {records.map((record) => (
          <SettingsRow
            key={recordKey(record)}
            label={record.label}
            description={KIND_LABELS[record.kind]}
          >
            {remove(record.label, () =>
              onRecords(records.filter((entry) => entry !== record)),
            )}
          </SettingsRow>
        ))}
        {sources.map((kind) => (
          <SettingsRow
            key={kind}
            label={CAPTURED_LABELS[kind]}
            description="On the records it can see"
          >
            {remove(CAPTURED_LABELS[kind], () =>
              onSources(sources.filter((entry) => entry !== kind)),
            )}
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

/**
 * The records it could read too, and the captured email and meetings once
 * someone has connected a mailbox or calendar (the CRM's "Add a record
 * type"). A workspace-wide agent already reads every record.
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
                onClick={() => pick(resource)}
              >
                <span className="text-sm">
                  {kind ? CAPTURED_LABELS[kind] : resource.label}
                </span>
                {resource.kind === "integration" ? null : (
                  <span className="text-xs text-muted-foreground">
                    {[KIND_LABELS[resource.kind], resource.detail]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
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
