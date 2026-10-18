import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Skeleton } from "@/client/components/ui/skeleton";
import { DealStageIndicator } from "@/client/features/deals/DealStage";
import { formatAmount } from "@/client/features/deals/dealFormat";
import { EmptyValue, OwnerCell } from "@/client/features/records/cells";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import { useOpenRecord } from "@/client/features/records/recordStack";
import { DEAL_STAGES, type DealStage } from "@/shared/crm-enums";

// A pipeline answer as a table, ported from the CRM's deal-list-result.tsx
// and agent-result.tsx: what `list_deals` returned, one row per deal, a row
// opening its deal. A list read in pages is one table, under its last page.
// The table is the reply's only row-level presentation, so a markdown table
// in the reply's text is dropped.

const LIST_DEALS = "list_deals";

const dealListResult = z
  .object({
    asOf: z.string().min(1),
    criteria: z.object({
      status: z.string().min(1),
      inactiveForDays: z.number().nullable(),
      companyId: z.string().nullable(),
      ownerId: z.string().nullable(),
    }),
    deals: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        stage: z.string().min(1),
        amount: z.number().nullable(),
        currency: z.string().min(1),
        company: z.object({ id: z.string().min(1), name: z.string() }),
        owner: z
          .object({ id: z.string(), name: z.string(), email: z.string() })
          .nullable(),
        daysSinceLastActivity: z.number(),
        neverActive: z.boolean().catch(false),
        expectedCloseDate: z.string().nullable(),
      }),
    ),
    hasMore: z.boolean().catch(false),
  })
  .nullable()
  .catch(null);

type DealList = NonNullable<z.infer<typeof dealListResult>>;

/**
 * The deal lists in a reply, keyed by the tool call each is drawn under: the
 * pages of one list (same criteria) merge into one table under the last.
 */
export function dealListsOf(message: UIMessage): Map<string, DealList> {
  const lists = new Map<string, { callId: string; list: DealList }>();
  for (const part of message.parts) {
    if (
      !isToolUIPart(part) ||
      getToolName(part) !== LIST_DEALS ||
      part.state !== "output-available"
    ) {
      continue;
    }
    const page = dealListResult.parse(part.output);
    if (!page) continue;
    const key = JSON.stringify(page.criteria);
    const deals = new Map(
      lists.get(key)?.list.deals.map((deal) => [deal.id, deal] as const),
    );
    for (const deal of page.deals) deals.set(deal.id, deal);
    // Re-inserted, so the merged table sits under the newest page.
    lists.delete(key);
    lists.set(key, {
      callId: part.toolCallId,
      list: { ...page, deals: [...deals.values()] },
    });
  }
  return new Map(
    [...lists.values()].map(({ callId, list }) => [callId, list] as const),
  );
}

/** Whether `part` is a `list_deals` call still running. */
export function isPendingDealList(part: UIMessage["parts"][number]): boolean {
  return (
    isToolUIPart(part) &&
    getToolName(part) === LIST_DEALS &&
    part.state !== "output-available" &&
    part.state !== "output-error"
  );
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/;

/** `markdown` without its tables: the deal table stands in for them. */
export function withoutTables(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.includes("|") && TABLE_SEPARATOR.test(lines[index + 1] ?? "")) {
      index += 1;
      while ((lines[index + 1] ?? "").includes("|")) index += 1;
      continue;
    }
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const STAGES: readonly string[] = DEAL_STAGES;

function isDealStage(stage: string): stage is DealStage {
  return STAGES.includes(stage);
}

function humanizeStage(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function tableTitle(list: DealList): string {
  const count = list.deals.length;
  const status =
    list.criteria.status === "all" ? "" : `${list.criteria.status} `;
  const stale = list.criteria.inactiveForDays === null ? "" : "stale ";
  return count === 0
    ? "No matching deals"
    : `${count} ${stale}${status}deal${count === 1 ? "" : "s"}`;
}

function pipelineTotal(list: DealList): string | null {
  const currencies = new Set(list.deals.map((deal) => deal.currency));
  const [currency] = [...currencies];
  if (currencies.size !== 1 || !currency) return null;
  const amount = list.deals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  return `${formatAmount(amount, currency)} pipeline`;
}

function tableMeta(list: DealList): string {
  return [
    `${list.deals.length} deal${list.deals.length === 1 ? "" : "s"}`,
    pipelineTotal(list),
    list.criteria.inactiveForDays === null
      ? null
      : `${list.criteria.inactiveForDays}+ days inactive`,
    list.hasMore ? "More results available" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One deal list: deal, company, stage, amount, owner, close date, idle days. */
export function DealListTable({ list }: { list: DealList }) {
  const openRecord = useOpenRecord();
  return (
    <section aria-label={tableTitle(list)} className="flex flex-col gap-2">
      <TableCard className="shadow-xs">
        <Table className="min-w-[44rem] table-fixed [&_td]:px-2 [&_th]:px-2">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[21%]">Deal</TableHead>
              <TableHead className="w-[16%]">Company</TableHead>
              <TableHead className="w-[17%]">Stage</TableHead>
              <TableHead className="w-[11%] text-right">Amount</TableHead>
              <TableHead className="w-[13%]">Owner</TableHead>
              <TableHead className="w-[15%]">Close date</TableHead>
              <TableHead className="w-[7%] text-right">Idle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.deals.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={7}
                  className="h-24 text-center whitespace-normal text-muted-foreground"
                >
                  No matching deals
                </TableCell>
              </TableRow>
            ) : (
              list.deals.map((deal) => (
                <TableRow
                  key={deal.id}
                  className="cursor-pointer"
                  onClick={() => openRecord({ kind: "deal", id: deal.id })}
                >
                  <TableCell className="truncate font-medium">
                    {/* The row opens it too; one navigation is enough. */}
                    <span onClick={(event) => event.stopPropagation()}>
                      <RecordLink record={{ kind: "deal", id: deal.id }}>
                        {deal.name}
                      </RecordLink>
                    </span>
                  </TableCell>
                  <TableCell className="truncate">
                    {deal.company.name || <EmptyValue />}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    {isDealStage(deal.stage) ? (
                      <DealStageIndicator
                        stage={deal.stage}
                        className="max-w-full"
                      />
                    ) : (
                      <span className="block truncate text-muted-foreground">
                        {humanizeStage(deal.stage)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {deal.amount === null ? (
                      <EmptyValue />
                    ) : (
                      formatAmount(deal.amount, deal.currency)
                    )}
                  </TableCell>
                  <TableCell>
                    <OwnerCell
                      owner={deal.owner ? { ...deal.owner, image: null } : null}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {deal.expectedCloseDate ? (
                      <LocalDay date={deal.expectedCloseDate} />
                    ) : (
                      <EmptyValue />
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right text-muted-foreground tabular-nums"
                    title={
                      deal.neverActive
                        ? "No activity has ever been recorded"
                        : undefined
                    }
                  >
                    {deal.daysSinceLastActivity}d
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{tableMeta(list)}</span>
        <span>
          As of <LocalDay date={list.asOf} />
        </span>
      </div>
    </section>
  );
}

/** While the pipeline is read. */
export function DealListSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-xs">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
