import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { websiteActivityQueryOptions } from "@/client/features/tracking/trackingQueries";
import type { WebsiteActivityInput } from "@/types/schemas/tracking";

type Touch = { source: string; medium: string | null };

function channel(touch: Touch): string {
  if (!touch.medium || touch.medium === "direct") return touch.source;
  return `${touch.source} · ${touch.medium}`;
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="truncate text-xs leading-5 text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * A record sheet's "Website activity": what the person (or a company's
 * people) did on the website, once a form submission tied their browser to
 * them. Renders nothing until then.
 */
export function WebsiteActivity({ record }: { record: WebsiteActivityInput }) {
  const { data: activity } = useQuery(websiteActivityQueryOptions(record));
  if (!activity?.identified) return null;
  if (activity.pages.length === 0 && !activity.firstTouch) return null;

  const [topPage] = activity.pages;
  const first = activity.firstTouch;
  const last = activity.lastTouch;
  const sourceChanged =
    first !== null && last !== null && channel(last) !== channel(first);
  const campaign = last?.campaign ?? first?.campaign ?? null;

  return (
    <SheetSection title="Website activity">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
        <Property label="Page views">
          <span className="tabular-nums">
            {activity.views.toLocaleString("en-US")}
          </span>
          {activity.lastSeenAt ? (
            <span className="text-muted-foreground">
              {" · last seen "}
              <RelativeTime date={activity.lastSeenAt} />
            </span>
          ) : null}
        </Property>
        {first ? (
          <Property label="Original source">{channel(first)}</Property>
        ) : null}
        {sourceChanged && last ? (
          <Property label="Latest source">{channel(last)}</Property>
        ) : null}
        {topPage ? (
          <Property label="Top page">
            <span className="flex min-w-0 items-baseline gap-1">
              <span
                className="truncate font-mono text-xs"
                title={`${topPage.host}${topPage.path}`}
              >
                {topPage.path}
              </span>
              <span className="shrink-0 text-muted-foreground">
                · <span className="tabular-nums">{topPage.views}</span>{" "}
                {topPage.views === 1 ? "view" : "views"}
              </span>
            </span>
          </Property>
        ) : null}
        {first?.at ? (
          <Property label="First seen">
            <RelativeTime date={first.at} />
          </Property>
        ) : null}
        {campaign ? <Property label="Campaign">{campaign}</Property> : null}
      </dl>
    </SheetSection>
  );
}
