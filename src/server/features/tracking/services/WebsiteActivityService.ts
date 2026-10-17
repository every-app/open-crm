import { describeTouch } from "@/server/features/tracking/attribution";
import { WebsiteActivityRepository } from "@/server/features/tracking/repositories/WebsiteActivityRepository";
import type { WebsiteActivityInput } from "@/types/schemas/tracking";

// The "Website activity" section of a contact's or company's sheet: what
// the browsers a form submission tied to them did on the website. A company
// shows its people's browsers together. Empty until one of them submits a
// form: page views alone identify nobody.

type TouchRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landing: string | null;
  referrer: string | null;
  at: string | null;
};

function summarise(touch: TouchRow) {
  if (!touch.source) return null;
  return {
    label: describeTouch(touch),
    source: touch.source,
    medium: touch.medium,
    campaign: touch.campaign,
    landing: touch.landing,
    referrer: touch.referrer,
    at: touch.at,
  };
}

async function forRecord(organizationId: string, record: WebsiteActivityInput) {
  const visitorIds = await WebsiteActivityRepository.visitorIdsFor(
    organizationId,
    record,
  );
  if (visitorIds.length === 0) {
    return {
      identified: false,
      visitors: 0,
      views: 0,
      lastSeenAt: null,
      pages: [],
      firstTouch: null,
      lastTouch: null,
    };
  }
  const activity = await WebsiteActivityRepository.activityOf(
    organizationId,
    visitorIds,
  );
  const { first, last } = activity;
  return {
    identified: true,
    visitors: visitorIds.length,
    views: activity.views,
    lastSeenAt: activity.lastSeenAt,
    pages: activity.pages.flatMap((page) =>
      page.lastSeenAt ? [{ ...page, lastSeenAt: page.lastSeenAt }] : [],
    ),
    firstTouch: first
      ? summarise({
          source: first.firstSource,
          medium: first.firstMedium,
          campaign: first.firstCampaign,
          landing: first.firstLanding,
          referrer: first.firstReferrer,
          at: first.firstTouchAt,
        })
      : null,
    lastTouch: last
      ? summarise({
          source: last.lastSource,
          medium: last.lastMedium,
          campaign: last.lastCampaign,
          landing: last.lastLanding,
          referrer: last.lastReferrer,
          at: last.lastTouchAt,
        })
      : null,
  };
}

export type WebsiteActivity = Awaited<ReturnType<typeof forRecord>>;

export const WebsiteActivityService = { forRecord };
