import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, History, ListFilter } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import type { getTeamAgentActivity } from "@/serverFunctions/teamAgents";
import { teamAgentActivityQueryOptions } from "./teamAgentQueries";

type AuditEvent = Awaited<ReturnType<typeof getTeamAgentActivity>>[number];

const KINDS = [
  { value: "agent.", label: "Agent changes" },
  { value: "run.", label: "Run requests" },
];

/**
 * A history filter chip (the Owner filter's pattern, for one value): its
 * name until a value is chosen, then the value; "all" clears it.
 */
export function HistoryFilter({
  name,
  icon: Icon,
  all,
  options,
  value,
  onChange,
}: {
  name: string;
  icon: LucideIcon;
  all: string;
  options: Array<{ value: string; label: string }>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Filter by ${name.toLowerCase()}`}
          />
        }
      >
        <Icon data-icon="inline-start" />
        {chosen?.label ?? name}
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next: string) => onChange(next || null)}
        >
          <DropdownMenuRadioItem value="" closeOnClick>
            {all}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Every change and run request, newest first (the CRM's agent activity). */
export function AgentActivity({ agentId }: { agentId: string }) {
  const activity = useQuery(teamAgentActivityQueryOptions(agentId));
  const [kind, setKind] = useState<string | null>(null);
  return (
    <QueryState
      query={activity}
      errorFallback="The activity could not be loaded."
    >
      {(rows) => {
        const visible = rows.filter(
          (event) => !kind || event.type.startsWith(kind),
        );
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <HistoryFilter
                name="Change"
                icon={ListFilter}
                all="All changes"
                options={KINDS}
                value={kind}
                onChange={setKind}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportJson("agent-activity.json", visible)}
              >
                <Download data-icon="inline-start" />
                Export
              </Button>
            </div>
            {visible.length === 0 ? (
              <EmptyState
                kind={kind ? "filtered" : "no-data"}
                icon={History}
                media={kind ? "icon" : "rows"}
                variant="plain"
                title="No changes"
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                <div className="hidden h-9 items-center border-b border-border px-4 text-xs text-muted-foreground sm:flex">
                  <span className="w-40 shrink-0">Time</span>
                  <span className="min-w-0 flex-1">Change</span>
                  <span className="w-28 shrink-0">Actor</span>
                  <span className="w-24 shrink-0 text-right">Request</span>
                </div>
                <ol className="divide-y divide-border">
                  {visible.map((event) => (
                    <ActivityRow key={event.id} event={event} />
                  ))}
                </ol>
              </div>
            )}
          </div>
        );
      }}
    </QueryState>
  );
}

function ActivityRow({ event }: { event: AuditEvent }) {
  const detail = changeDetail(event);
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-0">
      <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-40 sm:pt-0.5">
        <LocalDateTime date={event.emittedAt} />
      </span>
      <span className="min-w-0 flex-1 sm:pr-3">
        <span className="block text-sm">
          {event.summary}
          {event.versionNumber ? (
            <span className="text-xs text-muted-foreground">
              {" "}
              · version {event.versionNumber}
            </span>
          ) : null}
        </span>
        {detail ? (
          <span className="mt-0.5 block font-mono text-xs whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {detail}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs sm:w-28 sm:text-sm">
        <span className="text-muted-foreground sm:hidden">Actor · </span>
        {event.actorName ??
          (event.actorType === "AGENT" ? "The agent" : "The CRM")}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-24 sm:pt-0.5 sm:text-right">
        <span className="font-sans sm:hidden">Request · </span>
        {event.requestId?.slice(0, 12) ?? "—"}
      </span>
    </li>
  );
}

/** What a change was before and after, as the audit recorded it. */
function changeDetail(event: AuditEvent): string | null {
  const { before, after } = event;
  if (before === null && after === null) return null;
  if (before === null) return JSON.stringify(after);
  if (after === null) return JSON.stringify(before);
  return `${JSON.stringify(before)} → ${JSON.stringify(after)}`;
}

/** Saves the rows shown as a JSON file, from the browser. */
function exportJson(name: string, rows: AuditEvent[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
