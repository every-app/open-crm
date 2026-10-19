import type { TaskHold } from "@/shared/agent-availability";
import { AGENT_EVENT_KIND, DIRECT_KINDS } from "@/shared/agent-tasks";
import {
  DispatchHealthRepository,
  type LaneName,
} from "../repositories/DispatchHealthRepository";
import { AgentAvailabilityService } from "./AgentAvailabilityService";

// The dispatcher's health, as the CRM's agent reported it to monitoring
// (/internal/crm/dispatch-health): unhealthy when a lane has stopped running
// or work sits overdue. Here it is one organization's view: when each lane of
// the minute cron last ran (the deployment's, no organization's data), and
// the organization's own backlog in each. Work held on purpose (no model,
// scheduled research off) is waiting, not overdue.

const MINUTE_MS = 60_000;

/** A lane quiet this long has stalled; work due this long and not taken is overdue. */
const STALE_MS = 5 * MINUTE_MS;

/** What counts as a recent failure. */
const FAILURE_WINDOW_MS = 24 * 60 * MINUTE_MS;

function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

async function forOrganization(organizationId: string) {
  const now = Date.now();
  const window = {
    now: new Date(now).toISOString(),
    overdueBefore: new Date(now - STALE_MS).toISOString(),
    failedSince: new Date(now - FAILURE_WINDOW_MS).toISOString(),
  };
  const [hold, ran] = await Promise.all([
    AgentAvailabilityService.researchHold(organizationId),
    DispatchHealthRepository.lanes(),
  ]);
  const lastRan = (lane: LaneName) => {
    const row = ran.find((candidate) => candidate.lane === lane);
    return {
      lastRanAt: row?.ranAt ?? null,
      lastFailedAt: row?.failedAt ?? null,
    };
  };
  const researchHeld: TaskHold = hold.paused
    ? "setup"
    : hold.minPriority !== null
      ? "schedule"
      : null;
  const visible = await DispatchHealthRepository.taskBacklog(
    organizationId,
    { only: DIRECT_KINDS },
    { ...window, minPriority: null },
  );
  // Held for its schedule, only work a person asked for can be overdue.
  const research = await DispatchHealthRepository.taskBacklog(
    organizationId,
    { except: [...DIRECT_KINDS, AGENT_EVENT_KIND] },
    { ...window, minPriority: hold.minPriority },
  );
  const events = await DispatchHealthRepository.taskBacklog(
    organizationId,
    { only: [AGENT_EVENT_KIND] },
    { ...window, minPriority: null },
  );
  const runs = await DispatchHealthRepository.runBacklog(
    organizationId,
    window.failedSince,
  );
  const lanes = {
    visible: { ...lastRan("visible"), ...visible },
    research: {
      ...lastRan("research"),
      ...research,
      overdue: researchHeld === "setup" ? 0 : research.overdue,
      held: researchHeld,
    },
    // CRM events and the team agents' runs. A queued run may rightly wait
    // for the agent's run before it, so only events can be overdue.
    runs: {
      ...lastRan("runs"),
      backlog: events.backlog + runs.backlog,
      oldestDueAt: earliest(events.oldestDueAt, runs.oldestDueAt),
      overdue: events.overdue,
      failedLastDay: events.failedLastDay + runs.failedLastDay,
    },
    sweep: lastRan("sweep"),
  };
  const stalled = [lanes.visible, lanes.research, lanes.runs].some(
    (lane) =>
      lane.lastRanAt === null || now - Date.parse(lane.lastRanAt) > STALE_MS,
  );
  const overdue =
    lanes.visible.overdue + lanes.research.overdue + lanes.runs.overdue;
  return { ok: !stalled && overdue === 0, lanes };
}

export const DispatchHealthService = { forOrganization };
