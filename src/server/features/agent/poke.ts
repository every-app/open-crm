import { env, waitUntil } from "cloudflare:workers";
import { laneCreditCheck } from "@/server/billing/credits";
import { runVisibleLane } from "./dispatch";
import { collapsingByKey } from "./dispatch/pool";

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
 * Research waits for the cron. Never throws: queueing work must not fail the
 * request that queued it.
 */
export function pokeDispatcher(organizationId: string): void {
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
  } catch (error) {
    console.warn("[agent] could not poke the dispatcher", error);
  }
}
