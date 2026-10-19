import { env, waitUntil } from "cloudflare:workers";
import { collapsingByKey } from "@/server/features/agent/dispatch/pool";
import { TriggerService } from "../services/TriggerService";

// A run a person asked for (or a CRM event queued) starts now rather than on
// the next minute's tick: the team-agent lane, for that organization only.
// Pokes from one organization collapse into one lane per isolate. The lane
// (and the Agents SDK it reaches sessions with) loads on the first poke that
// has a run to start, not with every record service that can emit an event.
const runLaneFor = collapsingByKey(async (organizationId) => {
  const { runTeamAgentLane } = await import("./dispatch");
  await runTeamAgentLane(env, { organizationId, defer: waitUntil });
});

const eventsFor = collapsingByKey(async (organizationId) => {
  const queued = await TriggerService.queueEventRuns({ organizationId });
  if (queued > 0) await runLaneFor(organizationId);
});

/** Starts the organization's queued runs after the response. Never throws. */
export function pokeRuns(organizationId: string): void {
  try {
    waitUntil(
      runLaneFor(organizationId).catch((error: unknown) => {
        console.error(
          "[team-agents] poked lane failed",
          { organizationId },
          error,
        );
      }),
    );
  } catch (error) {
    console.warn("[team-agents] could not poke the run lane", error);
  }
}

/**
 * A record write queued CRM events (queueCrmEvents): after the response, the
 * organization's queued events become runs, which start. Never throws; the
 * minute cron turns whatever this misses into runs.
 */
export function pokeEvents(organizationId: string): void {
  try {
    waitUntil(
      eventsFor(organizationId).catch((error: unknown) => {
        console.error(
          "[team-agents] poked events failed",
          { organizationId },
          error,
        );
      }),
    );
  } catch (error) {
    console.warn("[team-agents] could not poke the event queue", error);
  }
}
