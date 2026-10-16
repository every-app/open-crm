import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { CompanyOverview } from "@/client/features/companies/CompanyOverview";
import { companyQueryOptions } from "@/client/features/companies/companyQueries";
import {
  formatMoney,
  location,
  type Company,
} from "@/client/features/companies/companyFormat";
import { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import { EnrichmentIndicator } from "@/client/features/records/EnrichmentStatus";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { RecordActionsMenu } from "@/client/features/records/RecordActionsMenu";
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
import { safeHttpUrl } from "@/shared/safe-url";

/** The company whose id is in the list's URL, in a sheet over the list. */
export function CompanySheet({
  companyId,
  tab,
  onTabChange,
  onClose,
}: {
  companyId: string | undefined;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  onClose: () => void;
}) {
  const shownId = useShownRecordId(companyId);
  return (
    <RecordSheet open={companyId !== undefined} onClose={onClose}>
      {shownId ? (
        <CompanySheetContent
          key={shownId}
          companyId={shownId}
          tab={tab}
          onTabChange={onTabChange}
          onClose={onClose}
        />
      ) : null}
    </RecordSheet>
  );
}

function CompanySheetContent({
  companyId,
  tab,
  onTabChange,
  onClose,
}: {
  companyId: string;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  onClose: () => void;
}) {
  const query = useQuery(companyQueryOptions(companyId));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const mutations = useCompanyMutations(companyId, { onPurged: onClose });
  const company = query.data;

  return (
    <RecordSheetFrame
      record={{ kind: "company", id: companyId }}
      header={
        company
          ? {
              media: (
                <EntityLogo
                  src={company.iconUrl ?? company.logoUrl}
                  darkSrc={company.iconDarkUrl}
                  tone={company.iconTone}
                  name={company.name}
                  size="lg"
                />
              ),
              title: company.name,
              description: metaLine(domainLink(company), [
                location(company),
                company.industry,
              ]),
              note: companyNote(company),
              actions: (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!company.domain}
                    title={company.domain ? undefined : "Add a domain first"}
                    pending={mutations.enrich.isPending}
                    onClick={() => mutations.enrich.mutate()}
                  >
                    {mutations.enrich.isPending ? null : (
                      <RefreshCw data-icon="inline-start" />
                    )}
                    <span className="max-sm:sr-only">Enrich now</span>
                  </Button>
                  <RecordActionsMenu
                    noun="company"
                    name={company.name}
                    archived={company.archivedAt !== null}
                    canPurge={canPurge}
                    consequence={purgeConsequence(company)}
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
            fallback="This company could not be loaded."
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        ) : undefined
      }
      stats={company ? <CompanyStats company={company} /> : undefined}
      tab={tab}
      onTabChange={onTabChange}
      overview={
        company ? (
          <CompanyOverview company={company} mutations={mutations} />
        ) : null
      }
    />
  );
}

/** "acme.com · Berlin, DE · Software", without blanks or repeats. */
function metaLine(lead: ReactNode, parts: (string | null)[]): ReactNode {
  const rest = [
    ...new Set(parts.flatMap((part) => (part?.trim() ? [part.trim()] : []))),
  ];
  if (!lead && rest.length === 0) return null;
  return (
    <>
      {lead}
      {rest.map((part, index) => (
        <span key={part}>
          {index === 0 && !lead ? null : " · "}
          {part}
        </span>
      ))}
    </>
  );
}

function domainLink(company: Company): ReactNode {
  const href =
    safeHttpUrl(company.website) ??
    (company.domain ? `https://${company.domain}` : null);
  const label = company.domain ?? company.website;
  if (!href || !label) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline-offset-4 hover:underline"
    >
      {label}
    </a>
  );
}

/** "Archived", and the agent's progress until it's done. */
function companyNote(company: Company): ReactNode {
  const archived = company.archivedAt !== null;
  const enriching = company.enrichmentStatus !== "COMPLETE";
  if (!archived && !enriching) return null;
  return (
    <>
      {archived ? <Badge variant="secondary">Archived</Badge> : null}
      {enriching ? (
        <EnrichmentIndicator
          status={company.enrichmentStatus}
          queued={company.queued}
          title={company.enrichmentError}
        />
      ) : null}
    </>
  );
}

function CompanyStats({ company }: { company: Company }) {
  const open = company.deals.filter((deal) => deal.open);
  const pipeline = open.reduce((sum, deal) => sum + (deal.baseAmount ?? 0), 0);
  // An amount in a currency with no rate yet isn't in the total.
  const unconverted = open.filter(
    (deal) => deal.amount !== null && deal.baseAmount === null,
  ).length;
  const nextClose = open
    .flatMap((deal) => (deal.expectedCloseDate ? [deal.expectedCloseDate] : []))
    .reduce<
      string | null
    >((soonest, date) => (soonest === null || date < soonest ? date : soonest), null);
  return (
    <SheetStats>
      <SheetStat label="Open pipeline">
        <span className="tabular-nums">
          {formatMoney(pipeline, company.reportingCurrency)}
        </span>
        {unconverted > 0 ? (
          <span
            className="font-normal text-muted-foreground"
            title={`${unconverted} open ${unconverted === 1 ? "deal is" : "deals are"} in a currency with no exchange rate yet`}
          >
            {" "}
            +{unconverted}
          </span>
        ) : null}
      </SheetStat>
      <SheetStat label="Open deals">
        <span className="tabular-nums">{open.length}</span>
      </SheetStat>
      <SheetStat label="Next close">
        {nextClose ? <LocalDay date={nextClose} /> : <EmptyValue />}
      </SheetStat>
      <SheetStat label="Owner">
        <OwnerCell owner={company.owner} />
      </SheetStat>
    </SheetStats>
  );
}

/** What deleting a company forever takes with it, for the confirmation. */
function purgeConsequence(company: Company): string {
  const deals = company.deals.length;
  const contacts = company.contacts.length;
  const gone =
    deals > 0
      ? `${deals === 1 ? "Its one deal" : `All ${deals} of its deals`} and everything filed against the account go too.`
      : "Everything filed against the account goes too.";
  const kept =
    contacts > 0
      ? ` ${contacts === 1 ? "The one person" : `The ${contacts} people`} who work there stay in the CRM, without a company.`
      : "";
  return gone + kept;
}
