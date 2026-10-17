import { CalendarClock, CircleDot, Milestone } from "lucide-react";
import { FilterChip } from "@/client/components/table/FilterChip";
import { DealStageIndicator } from "@/client/features/deals/DealStage";
import type { DealListSearch } from "@/client/features/deals/dealSearch";
import { chosen } from "@/client/features/records/ListFilters";
import { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER } from "@/shared/deal-stages";
import { CLOSING_WINDOWS, type ClosingWindow } from "@/types/schemas/deals";

// The deals list's own filters, after the shared search and owner filter:
// the pipeline or the outcomes, stages, and when deals are expected to close.

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

const STAGE_OPTIONS = DEAL_STAGE_ORDER.map((stage) => ({
  value: stage,
  label: DEAL_STAGE_LABELS[stage],
}));

const CLOSING_LABELS: Record<ClosingWindow, string> = {
  overdue: "Overdue",
  "this-month": "Closing this month",
  "next-month": "Closing next month",
  later: "Later",
  none: "No close date",
};

const CLOSING_OPTIONS = CLOSING_WINDOWS.map((window) => ({
  value: window,
  label: CLOSING_LABELS[window],
}));

export function DealFilters({
  search,
  onSearchChange,
}: {
  search: DealListSearch;
  onSearchChange: (update: Partial<DealListSearch>) => void;
}) {
  return (
    <>
      <FilterChip
        label="Status"
        icon={CircleDot}
        single
        options={STATUS_OPTIONS}
        value={search.status ? [search.status] : []}
        onChange={([status]) =>
          onSearchChange({
            status:
              status === "open" || status === "closed" ? status : undefined,
            page: undefined,
          })
        }
      />
      <FilterChip
        label="Stage"
        icon={Milestone}
        options={STAGE_OPTIONS}
        value={search.stage ?? []}
        renderOption={(option) => {
          const stage = DEAL_STAGE_ORDER.find(
            (value) => value === option.value,
          );
          return stage ? <DealStageIndicator stage={stage} /> : option.label;
        }}
        onChange={(values) =>
          onSearchChange({
            stage: chosen(
              DEAL_STAGE_ORDER.filter((stage) => values.includes(stage)),
            ),
            page: undefined,
          })
        }
      />
      <FilterChip
        label="Closing"
        icon={CalendarClock}
        options={CLOSING_OPTIONS}
        value={search.closing ?? []}
        onChange={(values) =>
          onSearchChange({
            closing: chosen(
              CLOSING_WINDOWS.filter((window) => values.includes(window)),
            ),
            page: undefined,
          })
        }
      />
    </>
  );
}
