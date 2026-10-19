// Whether the research agent can run for an organization, as the server
// works it out (AgentAvailabilityService) and every screen that shows the
// agent's progress reads it.

/**
 * The agent's model, as the CRM knows it:
 *
 * - `ready`: the model answered the agent's last call.
 * - `unchecked`: the gateway is connected, but nothing has asked the model
 *   anything lately, so the CRM can't say yet.
 * - `missing`: this deployment has no way to the model at all (no gateway
 *   binding, and in local development no key in .dev.vars).
 * - `refused`: the gateway refused the model lately for want of a key.
 */
export type ModelState = "ready" | "unchecked" | "missing" | "refused";

/** The agent can't run: work for it waits until the model is set up. */
export function modelBlocked(state: ModelState): boolean {
  return state === "missing" || state === "refused";
}

/** What the agent has to work with, for Settings, the checklist and Home. */
export type AgentAvailability = {
  model: ModelState;
  /** The gateway's own words when it refused the model. */
  modelRefusal: string | null;
  /** Context.dev (logos, brand data, LinkedIn) is set up on the gateway. */
  context: boolean;
  /**
   * The agent researches on its own schedule; the organization may hold that
   * to work a person asked for (Research automatically).
   */
  scheduledResearch: boolean;
};

/** What holds an open task back: the model's setup, the schedule, or nothing. */
export type TaskHold = "setup" | "schedule" | null;
