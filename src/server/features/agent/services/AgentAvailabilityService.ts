import { GATEWAY_ERROR_HEADER } from "@every-app/sdk/internal";
import { gatewayRefusal } from "@every-app/sdk/server";
import { getOpenRouterFetch } from "@/server/lib/openrouter";
import { hasContextAccess } from "@/server/lib/provider-access";
import {
  deploymentTierFor,
  scheduledResearchEnabled,
} from "@/server/lib/deployment-tier";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import { ASKED_FOR_PRIORITY, DIRECT_KINDS } from "@/shared/agent-tasks";
import type {
  AgentAvailability,
  ModelState,
  TaskHold,
} from "@/shared/agent-availability";
import {
  AgentAvailabilityRepository,
  type ModelSighting,
} from "../repositories/AgentAvailabilityRepository";

// Whether the research agent can run for an organization. Context.dev is a
// gateway capability, so its status is asked for (integrationStatus). The
// model is not: the gateway's AI proxy has no status route, only refusals.
// So the CRM learns it from the gateway's answers to the agent's own calls:
// a refusal for want of a key (`ai_provider_not_configured`) is recorded for
// the organization, and the model's next answer clears it. A refusal is
// believed for a bounded time: the dispatcher tries again after
// MODEL_RETRY_MS, so a key set on the gateway later is picked up with nobody
// doing anything, and screens stop saying so after MODEL_REFUSAL_FRESH_MS
// when nothing has tried since.

const MINUTE_MS = 60_000;

/** The gateway's refusal when it holds no key for the model. */
const NOT_CONFIGURED = "ai_provider_not_configured";

/** How long the dispatcher holds an organization's research after a refusal. */
export const MODEL_RETRY_MS = 10 * MINUTE_MS;

/** How long a refusal nobody has retried still says "not set up". */
const MODEL_REFUSAL_FRESH_MS = 15 * MINUTE_MS;

/** An answer is recorded at most this often per organization and isolate. */
const ANSWER_NOTE_MS = 5 * MINUTE_MS;

const answersNoted = new Map<string, number>();

/** The model's state from what the gateway last said about it. */
function modelStateOf(
  configured: boolean,
  { refusedAt, answeredAt }: ModelSighting,
  now: number,
): ModelState {
  if (!configured) return "missing";
  if (answeredAt && (!refusedAt || answeredAt >= refusedAt)) return "ready";
  if (refusedAt && now - Date.parse(refusedAt) < MODEL_REFUSAL_FRESH_MS) {
    return "refused";
  }
  return "unchecked";
}

async function modelOf(organizationId: string) {
  const env = (await getWorkersEnv()) ?? {};
  const sighting = await AgentAvailabilityRepository.read(organizationId);
  const state = modelStateOf(
    getOpenRouterFetch(env, organizationId) !== null,
    sighting,
    Date.now(),
  );
  return {
    env,
    state,
    refusal: state === "refused" ? sighting.refusal : null,
  };
}

/** What the organization's agent has to work with. */
async function forOrganization(
  organizationId: string,
): Promise<AgentAvailability> {
  const [model, context] = await Promise.all([
    modelOf(organizationId),
    hasContextAccess(),
  ]);
  return {
    model: model.state,
    modelRefusal: model.refusal,
    context,
    scheduledResearch: scheduledResearchEnabled(model.env),
    tier: deploymentTierFor(model.env),
  };
}

/**
 * What holds the organization's research back: the model (`paused`), and
 * on a first-party deployment holding scheduled research, every task below
 * the work a person asked for (`minPriority`).
 */
export type ResearchHold = { paused: boolean; minPriority: number | null };

async function researchHold(organizationId: string): Promise<ResearchHold> {
  const model = await modelOf(organizationId);
  return {
    paused: model.state === "missing" || model.state === "refused",
    minPriority: scheduledResearchEnabled(model.env)
      ? null
      : ASKED_FOR_PRIORITY,
  };
}

const DIRECT = new Set<string>(DIRECT_KINDS);

/**
 * What keeps an open task from running: the model's setup, the schedule, or
 * nothing. Logos and photos (the visible lane) need no model, so nothing
 * holds them.
 */
export function taskHold(
  task: { kind: string; priority: number },
  hold: ResearchHold,
): TaskHold {
  if (DIRECT.has(task.kind)) return null;
  if (hold.paused) return "setup";
  if (hold.minPriority !== null && task.priority < hold.minPriority) {
    return "schedule";
  }
  return null;
}

/** The gateway refused the organization's model for want of a key. */
async function noteRefusal(
  organizationId: string,
  message: string,
): Promise<void> {
  answersNoted.delete(organizationId);
  await AgentAvailabilityRepository.noteRefusal(organizationId, message);
  console.warn("[agent] the gateway has no model key", {
    organizationId,
    message,
  });
}

/**
 * Reads the gateway's answer to one of the agent's model calls: a refusal
 * for want of a key holds the organization's research, an answer clears it.
 * Never throws: noting it must not fail the call.
 */
async function noteModelResponse(
  organizationId: string,
  response: Response,
): Promise<void> {
  try {
    if (response.headers.get(GATEWAY_ERROR_HEADER) === NOT_CONFIGURED) {
      const refusal = await gatewayRefusal(response.clone());
      await noteRefusal(
        organizationId,
        refusal?.message ?? "The gateway holds no key for the agent's model.",
      );
      return;
    }
    if (!response.ok) return;
    const noted = answersNoted.get(organizationId);
    if (noted !== undefined && Date.now() - noted < ANSWER_NOTE_MS) return;
    answersNoted.set(organizationId, Date.now());
    await AgentAvailabilityRepository.noteAnswer(organizationId);
  } catch (error) {
    console.error(
      "[agent] could not note the model's answer",
      { organizationId },
      error,
    );
  }
}

export const AgentAvailabilityService = {
  forOrganization,
  researchHold,
  noteRefusal,
  noteModelResponse,
};
