import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { DealContacts } from "@/client/features/deals/DealContacts";
import { DealOverview } from "@/client/features/deals/DealOverview";
import { DealStageMenu } from "@/client/features/deals/DealStage";
import {
  formatAmount,
  PURGE_CONSEQUENCE,
  type Deal,
} from "@/client/features/deals/dealFormat";
import { dealQueryOptions } from "@/client/features/deals/dealQueries";
import { useDealMutations } from "@/client/features/deals/useDealMutations";
import {
  LocalDay,
  RelativeTime,
} from "@/client/features/records/LocalDateTime";
import { RecordActionsMenu } from "@/client/features/records/RecordActionsMenu";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  RecordSheetFrame,
  SheetStat,
  SheetStats,
} from "@/client/features/records/RecordSheet";
import { useRecordStack } from "@/client/features/records/recordStack";
import {
  EmptyValue,
  EntityLogo,
  OwnerCell,
} from "@/client/features/records/cells";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/** A deal's sheet, over whatever page opened it (RecordSheetHost). */
export function DealSheet({ dealId }: { dealId: string }) {
  const query = useQuery(dealQueryOptions(dealId));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const { back } = useRecordStack();
  // Deleted forever: its sheet goes, and the one under it shows again.
  const mutations = useDealMutations(dealId, { onPurged: back });
  const deal = query.data;

  return (
    <RecordSheetFrame
      archivedAt={deal?.archivedAt}
      record={{ kind: "deal", id: dealId }}
      header={
        deal
          ? {
              media: (
                <EntityLogo
                  src={deal.company.iconUrl ?? deal.company.logoUrl}
                  darkSrc={deal.company.iconDarkUrl}
                  tone={deal.company.iconTone}
                  name={deal.company.name}
                  size="lg"
                />
              ),
              title: deal.name,
              description: (
                <RecordLink
                  record={{ kind: "company", id: deal.company.id }}
                  className="text-foreground"
                >
                  {deal.company.name}
                </RecordLink>
              ),
              note: deal.archivedAt ? (
                <Badge variant="secondary">Archived</Badge>
              ) : null,
              actions: (
                <>
                  <DealStageMenu
                    dealId={deal.id}
                    stage={deal.stage}
                    variant="control"
                  />
                  <RecordActionsMenu
                    name={deal.name}
                    archived={deal.archivedAt !== null}
                    canPurge={canPurge}
                    consequence={PURGE_CONSEQUENCE}
                    pending={
                      mutations.archive.isPending ||
                      mutations.restore.isPending ||
                      mutations.purge.isPending
                    }
                    onArchive={() => mutations.archive.mutate()}
                    onRestore={() => mutations.restore.mutate()}
                    onPurge={() => mutations.purge.mutate()}
                  />
                </>
              ),
            }
          : undefined
      }
      error={
        query.isError ? (
          <QueryError
            error={query.error}
            fallback="This deal could not be loaded."
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        ) : undefined
      }
      stats={deal ? <DealStats deal={deal} /> : undefined}
      overview={
        deal ? <DealOverview deal={deal} mutations={mutations} /> : null
      }
      lists={
        deal
          ? [
              {
                value: "contacts",
                content: <DealContacts deal={deal} mutations={mutations} />,
              },
            ]
          : undefined
      }
    />
  );
}

function DealStats({ deal }: { deal: Deal }) {
  return (
    <SheetStats>
      <SheetStat label="Amount">
        {deal.amount === null ? (
          <EmptyValue />
        ) : (
          <span className="tabular-nums">
            {formatAmount(deal.amount, deal.currency)}
          </span>
        )}
      </SheetStat>
      <SheetStat label="Close date">
        {deal.expectedCloseDate ? (
          <LocalDay date={deal.expectedCloseDate} />
        ) : (
          <EmptyValue />
        )}
      </SheetStat>
      <SheetStat label="Stage changed">
        <RelativeTime date={deal.stageChangedAt} />
      </SheetStat>
      <SheetStat label="Owner">
        <OwnerCell owner={deal.owner} />
      </SheetStat>
    </SheetStats>
  );
}
