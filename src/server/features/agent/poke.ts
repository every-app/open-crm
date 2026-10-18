import { env, waitUntil } from "cloudflare:workers";
import { laneCreditCheck } from "@/server/billing/credits";
import { runVisibleLane } from "./dispatch";
import { collapsingByKey } from "./dispatch/pool";
import { storeFavicon } from "./visible/brand";

// Pokes from one organization collapse into one visible lane per isolate (a
// CSV of forty companies pokes forty times); its leases keep it from taking
// what another isolate's lane, or the minute cron, has taken.
const runVisibleLaneFor = collapsingByKey(async (organizationId) => {
  await runVisibleLane({
    organizationId,
    defer: waitUntil,
    credits: laneCreditCheck(env),
  });
});

/**
 * Asks the dispatcher to run `organizationId`'s visible lane now instead of on
 * the next minute's tick, so a new company's logo appears as it is added.
 * With `faviconOf`, a company a person just added or gave a new domain, its
 * favicon is fetched now too, as the CRM fetched it then
 * (companies.service.ts): free, so it waits for neither the lane nor
 * credits, and a brand found later replaces it. Research waits for the cron.
 * Never throws: queueing work must not fail the request that queued it.
 */
export function pokeDispatcher(
  organizationId: string,
  faviconOf?: string,
): void {
  try {
    waitUntil(
      runVisibleLaneFor(organizationId).catch((error: unknown) => {
        console.error(
          "[agent] poked visible lane failed",
          { organizationId },
          error,
        );
      }),
    );
    if (!faviconOf) return;
    waitUntil(
      storeFavicon({ organizationId, companyId: faviconOf }).catch(
        (error: unknown) => {
          console.warn(
            "[agent] could not fetch a favicon",
            { organizationId, companyId: faviconOf },
            error,
          );
        },
      ),
    );
  } catch (error) {
    console.warn("[agent] could not poke the dispatcher", error);
  }
}
