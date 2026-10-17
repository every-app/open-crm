import { env, waitUntil } from "cloudflare:workers";
import { collapsingByKey } from "@/server/features/agent/dispatch/pool";
import { runTeamAgentLane } from "./dispatch";

// A run a person asked for (or an event queued) starts now rather than on the
// next minute's tick: the team-agent lane, for that organization only. Pokes
// from one organization collapse into one lane per isolate.
const runLaneFor = collapsingByKey(async (organizationId) => {
  await runTeamAgentLane(env, { organizationId, defer: waitUntil });
});

/** Starts the organization's queued runs after the response. Never throws. */
export function pokeRuns(organizationId: string): void {
  try {
    waitUntil(
      runLaneFor(organizationId).catch((error: unknown) => {
        console.error("[team-agents] poked lane failed", { organizationId }, error);
      }),
    );
  } catch (error) {
    console.warn("[team-agents] could not poke the run lane", error);
  }
}
