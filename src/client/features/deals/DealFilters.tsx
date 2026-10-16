import type { ReactNode } from "react";
import { CalendarClock, Milestone } from "lucide-react";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { DealStageIndicator } from "@/client/features/deals/DealStage";
import type { DealListSearch } from "@/client/features/deals/dealSearch";
import { DEAL_STAGE_ORDER } from "@/shared/deal-stages";
import { CLOSING_WINDOWS, type ClosingWindow } from "@/types/schemas/deals";

// The deals list's own filters, after the shared search and owner filter:
// the pipeline or the outcomes, stages, and when deals are expected to close.

const CLOSING_LABELS: Record<ClosingWindow, string> = {
  overdue: "Overdue",
  "this-month": "Closing this month",
  "next-month": "Closing next month",
  later: "Later",
  none: "No close date",
};

const STATUSES = [
  { value: "all", icon: null, label: "All" },
  { value: "open", icon: null, label: "Open" },
  { value: "closed", icon: null, label: "Closed" },
] as const;

/** A filter that keeps any of the chosen values. */
function ChoiceFilter<T extends string>({
  label,
  heading,
  icon,
  options,
  value,
  onChange,
}: {
  label: string;
  heading: string;
  icon: ReactNode;
  options: { value: T; label: ReactNode }[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Filter by ${label.toLowerCase()}`}
          />
        }
      >
        {icon}
        {label}
        {value.length > 0 ? (
          <Badge size="sm" aria-label={`${value.length} chosen`}>
            {value.length}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{heading}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={value.includes(option.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, option.value]
                    : value.filter((chosen) => chosen !== option.value),
                )
              }
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {value.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange([])}>
              Clear
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DealFilters({
  search,
  onSearchChange,
}: {
  search: DealListSearch;
  onSearchChange: (update: Partial<DealListSearch>) => void;
}) {
  return (
    <>
      <SegmentedToggle
        items={[...STATUSES]}
        value={search.status ?? "all"}
        showLabels
        onChange={(status) =>
          onSearchChange({
            status: status === "all" ? undefined : status,
            page: undefined,
          })
        }
      />
      <ChoiceFilter
        label="Stage"
        heading="In stage"
        icon={<Milestone data-icon="inline-start" />}
        options={DEAL_STAGE_ORDER.map((stage) => ({
          value: stage,
          label: <DealStageIndicator stage={stage} />,
        }))}
        value={search.stage ?? []}
        onChange={(stage) =>
          onSearchChange({
            stage: stage.length > 0 ? stage : undefined,
            page: undefined,
          })
        }
      />
      <ChoiceFilter
        label="Closing"
        heading="Expected to close"
        icon={<CalendarClock data-icon="inline-start" />}
        options={CLOSING_WINDOWS.map((window) => ({
          value: window,
          label: CLOSING_LABELS[window],
        }))}
        value={search.closing ?? []}
        onChange={(closing) =>
          onSearchChange({
            closing: closing.length > 0 ? closing : undefined,
            page: undefined,
          })
        }
      />
    </>
  );
}
