import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { CompanyOverview } from "@/client/features/companies/CompanyOverview";
import { CompanyRelated } from "@/client/features/companies/CompanySections";
import { companyQueryOptions } from "@/client/features/companies/companyQueries";
import {
  formatMoney,
  type Company,
} from "@/client/features/companies/companyFormat";
import { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import { CloseDate } from "@/client/features/deals/closeDate";
import { RecordListsSection } from "@/client/features/lists/RecordListsSection";
import { RecordActionsMenu } from "@/client/features/records/RecordActionsMenu";
import { RecordSheetFrame } from "@/client/features/records/RecordSheet";
import { useRecordStack } from "@/client/features/records/recordStack";
import { EmptyValue, EntityLogo } from "@/client/features/records/cells";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";
import { safeHttpUrl } from "@/shared/safe-url";

/** A company's sheet, over whatever page opened it (RecordSheetHost). */
export function CompanySheet({ companyId }: { companyId: string }) {
  const query = useQuery(companyQueryOptions(companyId));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const dealsEnabled = workspace.data?.dealsEnabled ?? false;
  const { back } = useRecordStack();
  // Deleted forever: its sheet goes, and the one under it shows again.
  const mutations = useCompanyMutations(companyId, { onPurged: back });
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
              description: metaLine(domainLink(company), [company.industry]),
              note: companyNote(company),
              actions: (
                <RecordActionsMenu
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
      archived={
        company?.archivedAt
          ? {
              at: company.archivedAt,
              restoring: mutations.restore.isPending,
              onRestore: () => mutations.restore.mutate(),
            }
          : undefined
      }
    >
      {company ? (
        <>
          {/* Its pipeline, while it has an open deal (and deals are on). */}
          {dealsEnabled && company.deals.some((deal) => deal.open) ? (
            <CompanyPipeline company={company} />
          ) : null}
          <RecordListsSection entity="COMPANY" recordId={company.id} />
          <CompanyOverview company={company} mutations={mutations} />
          <CompanyRelated
            company={company}
            mutations={mutations}
            dealsEnabled={dealsEnabled}
          />
        </>
      ) : null}
    </RecordSheetFrame>
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

/** "Archived", on an archived company. */
function companyNote(company: Company): ReactNode {
  return company.archivedAt !== null ? (
    <Badge variant="secondary">Archived</Badge>
  ) : null;
}

/** What the company's open deals come to, and when the next should close. */
function CompanyPipeline({ company }: { company: Company }) {
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
    // On a phone the pipeline takes the room the other two leave.
    <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-px border-b border-border bg-border sm:grid-cols-3">
      <Stat label="Open pipeline">
        <span className="tabular-nums">
          {formatMoney(pipeline, company.reportingCurrency)}
        </span>
        {unconverted > 0 ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            +{unconverted} unconverted
          </span>
        ) : null}
      </Stat>
      <Stat label="Open deals">
        <span className="tabular-nums">{open.length}</span>
      </Stat>
      <Stat label="Next close">
        {nextClose ? <CloseDate date={nextClose} open /> : <EmptyValue />}
      </Stat>
    </dl>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-popover px-5 py-2.5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * What deleting a company forever takes with it, for the confirmation: every
 * deal, archived ones included.
 */
function purgeConsequence(company: Company): string {
  const deals = company.dealCount;
  return deals > 0
    ? `${deals === 1 ? "Its one deal" : `All ${deals} of its deals`} and everything on its record go too.`
    : "Everything on its record goes too.";
}
