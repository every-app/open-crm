import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { DealOverview } from "@/client/features/deals/DealOverview";
import { DealStageMenu } from "@/client/features/deals/DealStage";
import {
  formatAmount,
  purgeConsequence,
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
  RecordSheet,
  RecordSheetFrame,
  SheetStat,
  SheetStats,
  useShownRecordId,
} from "@/client/features/records/RecordSheet";
import {
  EmptyValue,
  EntityLogo,
  OwnerCell,
} from "@/client/features/records/cells";
import type { RecordTab } from "@/client/features/records/listSearch";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/** The deal whose id is in the list's URL, in a sheet over the list. */
export function DealSheet({
  dealId,
  tab,
  onTabChange,
  onClose,
}: {
  dealId: string | undefined;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  onClose: () => void;
}) {
  const shownId = useShownRecordId(dealId);
  return (
    <RecordSheet open={dealId !== undefined} onClose={onClose}>
      {shownId ? (
        <DealSheetContent
          key={shownId}
          dealId={shownId}
          tab={tab}
          onTabChange={onTabChange}
          onClose={onClose}
        />
      ) : null}
    </RecordSheet>
  );
}

function DealSheetContent({
  dealId,
  tab,
  onTabChange,
  onClose,
}: {
  dealId: string;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  onClose: () => void;
}) {
  const query = useQuery(dealQueryOptions(dealId));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const mutations = useDealMutations(dealId, { onPurged: onClose });
  const deal = query.data;

  return (
    <RecordSheetFrame
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
                    noun="deal"
                    name={deal.name}
                    archived={deal.archivedAt !== null}
                    canPurge={canPurge}
                    consequence={purgeConsequence(deal)}
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
      tab={tab}
      onTabChange={onTabChange}
      overview={
        deal ? <DealOverview deal={deal} mutations={mutations} /> : null
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
      <SheetStat label="Expected close">
        {deal.expectedCloseDate ? (
          <LocalDay date={deal.expectedCloseDate} />
        ) : (
          <EmptyValue />
        )}
      </SheetStat>
      <SheetStat label="In stage since">
        <RelativeTime date={deal.stageChangedAt} />
      </SheetStat>
      <SheetStat label="Owner">
        <OwnerCell owner={deal.owner} />
      </SheetStat>
    </SheetStats>
  );
}
