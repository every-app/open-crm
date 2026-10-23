import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Badge } from "@/client/components/ui/badge";
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

/** A label, marked when what it names waits for review. */
export function ReviewLabel({
  label,
  inReview,
}: {
  label: string;
  inReview: boolean;
}) {
  if (!inReview) return label;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {label}
      <Badge variant="outline">In review</Badge>
    </span>
  );
}

/**
 * What the agent reads (the CRM's "What it can see"): its records and the
 * captured email and meetings, as the page's unsaved changes have them. A
 * workspace-wide agent can be narrowed to chosen records.
 */
export function AgentScope({
  workspace,
  narrowable,
  records,
  sources,
  inReview,
  canManage,
  disabled,
  onRecords,
  onSources,
}: {
  /** It reads every record in the workspace. */
  workspace: boolean;
  /** A workspace-wide agent may be narrowed to chosen records. */
  narrowable: boolean;
  records: RecordResource[];
  sources: CaptureKind[];
  /** The records and sources (by `recordKey`) that wait for review. */
  inReview: ReadonlySet<string>;
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
            offersRecords={!workspace || narrowable}
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
        {workspace && records.length === 0 ? (
          <SettingsRow label="Every record in the workspace" />
        ) : null}
        {records.map((record) => (
          <SettingsRow
            key={recordKey(record)}
            label={
              <ReviewLabel
                label={record.label}
                inReview={inReview.has(recordKey(record))}
              />
            }
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
            label={
              <ReviewLabel
                label={CAPTURED_LABELS[kind]}
                inReview={inReview.has(
                  recordKey(CAPTURE_GRANTS[kind].resource),
                )}
              />
            }
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
 * The records it could read (or, for a workspace-wide agent, the ones to
 * narrow it to), and the captured email and meetings once someone has
 * connected a mailbox or calendar (the CRM's "Add records or sources").
 */
function RecordTypePicker({
  offersRecords,
  taken,
  onRecord,
  onSource,
}: {
  offersRecords: boolean;
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
        : offersRecords),
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
        Add records or sources
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
