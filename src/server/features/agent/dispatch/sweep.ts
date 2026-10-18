import type { CreditCheck } from "@/server/billing/credits";
import { PRIORITY } from "@/shared/agent-tasks";
import { AgentSweepRepository } from "../repositories/AgentSweepRepository";
import { AgentTaskService } from "../services/AgentTaskService";
import { DISPATCH } from "./config";

// The enrichment sweep, ported from the CRM's automatic backfill
// (BackfillService.auto). It queues work, never does it: the lanes do, from
// the same tick on. For each organization it finds
//
// - the workspace's own website with no profile yet (a week between tries);
// - companies never successfully looked up: their brand and their profile,
//   once Context.dev is there to look them up, a failed one a day apart;
// - companies with neither logo nor icon: their brand, which falls back on
//   the company's favicon (a month between tries);
// - contacts with no photo and somewhere to look for one: their portrait (a
//   month between tries);
// - contacts never successfully researched: identify (a day apart).
//
// Where the CRM saved a Context.dev key and queued the companies waiting on
// it, the port reads the gateway's answer on every sweep: work that needs the
// key waits for it, and goes on the first sweep that finds it.
//
// The CRM swept when someone signed in, at most every five minutes. The port
// has no sign-in of its own, so the minute cron takes a few organizations a
// tick, each at most every five minutes. It is scheduled research: held with
// it (FIRST_PARTY_SCHEDULED_RESEARCH), and an organization out of credits is
// skipped.

/** Sweeps the organizations due one; how many it swept. */
export async function runEnrichmentSweep(options: {
  contextReady: () => Promise<boolean>;
  credits?: CreditCheck;
  signal?: AbortSignal;
}): Promise<number> {
  const { everyMs, organizations } = DISPATCH.enrichment;
  const due = await AgentSweepRepository.claimDue(organizations, everyMs);
  if (due.length === 0) return 0;
  const contextReady = await options.contextReady();
  for (const organizationId of due) {
    if (options.signal?.aborted) break;
    try {
      await sweepOrganization(organizationId, contextReady, options.credits);
    } catch (error) {
      console.error(
        "[agent] enrichment sweep failed",
        { organizationId },
        error,
      );
    }
  }
  return due.length;
}

async function sweepOrganization(
  organizationId: string,
  contextReady: boolean,
  credits: CreditCheck | undefined,
): Promise<void> {
  const limits = DISPATCH.enrichment;
  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();
  const website = await AgentSweepRepository.websiteWithoutProfile(
    organizationId,
    since(limits.workspaceRecheckMs),
  );
  const neverLookedUp = contextReady
    ? await AgentSweepRepository.companiesNeverLookedUp(
        organizationId,
        since(limits.failedRetryMs),
        limits.maxPerRun,
      )
    : [];
  const withoutArtwork = await AgentSweepRepository.companiesWithoutArtwork(
    organizationId,
    since(limits.artworkRecheckMs),
    limits.maxPerRun,
  );
  const photos = await AgentSweepRepository.contactsNeedingPhoto(
    organizationId,
    {
      contextReady,
      endedSince: since(limits.photoRecheckMs),
      limit: limits.maxPerRun,
    },
  );
  const headroom = limits.maxPerRun - photos.length;
  const neverResearched =
    headroom > 0
      ? await AgentSweepRepository.contactsNeverResearched(
          organizationId,
          since(limits.failedRetryMs),
          headroom,
        )
      : [];
  const brands = [...new Set([...neverLookedUp, ...withoutArtwork])].slice(
    0,
    limits.maxPerRun,
  );
  if (
    !website &&
    brands.length === 0 &&
    photos.length === 0 &&
    neverResearched.length === 0
  ) {
    return;
  }
  if (credits && !(await credits(organizationId))) return;

  if (website) {
    await AgentTaskService.workspaceChanged(
      organizationId,
      website,
      "We still have no profile of the company using this CRM",
    );
  }
  const work = [
    {
      kind: "brand",
      reason: "Backfill: this company has no logo or icon",
      companyIds: brands,
      budget: 2,
      priority: PRIORITY.brand,
    },
    {
      kind: "company-profile",
      reason: "Backfill: this company was never successfully looked up",
      companyIds: neverLookedUp,
    },
    {
      kind: "portrait",
      reason: "Backfill: somewhere to look for a picture, and no picture",
      contactIds: photos,
      budget: 1,
      priority: PRIORITY.portrait,
    },
    {
      kind: "identify",
      reason: "Backfill: this contact was never researched",
      contactIds: neverResearched,
    },
  ];
  let queued = 0;
  for (const backfill of work) {
    queued += (await AgentTaskService.backfill(organizationId, backfill))
      .queued;
  }
  console.log("[agent] enrichment sweep queued", {
    organizationId,
    workspace: Boolean(website),
    queued,
  });
}
