import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AppWindow,
  AtSign,
  CalendarDays,
  Hash,
  Mail,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/client/components/ui/input";
import { InputGroupButton } from "@/client/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EntityLogo, PersonAvatar } from "@/client/features/records/cells";
import type { searchBuilderResources } from "@/serverFunctions/teamAgents";
import { CAPTURE_GRANTS, taggedSlackChannel } from "@/shared/team-agents";
import { builderResourcesQueryOptions } from "./teamAgentQueries";

// The composer's tag picker, the CRM's builder resources: a record, an
// integration or a Slack channel a message is about.

type Resource = Awaited<ReturnType<typeof searchBuilderResources>>[number];

/** A record or integration a message is tagged with. */
export type TaggedResource = Pick<Resource, "kind" | "id" | "label">;

/** A tag as a message shows it: a Slack channel by its own name. */
export const tagText = (label: string) =>
  label.startsWith("#") ? label : `@${label}`;

const INTEGRATION_ICONS: Record<string, LucideIcon> = {
  [CAPTURE_GRANTS.email.resource.id]: Mail,
  [CAPTURE_GRANTS.calendar.resource.id]: CalendarDays,
};

/** A record's logo or photo, or an integration's icon. */
function ResourcePicture({ resource }: { resource: Resource }) {
  if (resource.kind === "contact") {
    return (
      <PersonAvatar
        src={resource.picture.url}
        name={resource.label}
        size="sm"
      />
    );
  }
  if (resource.kind !== "integration") {
    return (
      <EntityLogo
        src={resource.picture.url}
        darkSrc={resource.picture.darkUrl}
        tone={resource.picture.tone}
        name={resource.label}
        size="sm"
      />
    );
  }
  const Icon =
    INTEGRATION_ICONS[resource.id] ??
    (taggedSlackChannel(resource.id) ? Hash : AppWindow);
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-3" aria-hidden />
    </span>
  );
}

/**
 * Tag a record or integration: the connected integrations, and before
 * anything is typed, the most recently active records.
 */
export function TagPicker({
  onPick,
}: {
  onPick: (tag: TaggedResource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useQuery({
    ...builderResourcesQueryOptions(query),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            size="icon-sm"
            aria-label="Tag CRM records and integrations"
          />
        }
      >
        <AtSign />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search CRM"
            aria-label="Search CRM"
          />
        </div>
        <div className="flex max-h-72 flex-col overflow-y-auto p-1">
          {results.isPending ? (
            <div className="flex flex-col gap-1 px-2 py-1">
              {["first", "second", "third"].map((row) => (
                <div key={row} className="flex h-8 items-center gap-2">
                  <Skeleton className="size-5 shrink-0" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : null}
          {(results.data ?? []).map((resource) => (
            <button
              key={`${resource.kind}:${resource.id}`}
              type="button"
              onClick={() => {
                onPick({
                  kind: resource.kind,
                  id: resource.id,
                  label: resource.label,
                });
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <ResourcePicture resource={resource} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{resource.label}</span>
                {resource.detail ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {resource.detail}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          {results.data?.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No matching records.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
