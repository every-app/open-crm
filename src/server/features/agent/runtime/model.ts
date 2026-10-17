import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { withPgClient } from "@/db";
import {
  buildAgentModel,
  DEFAULT_AGENT_MODEL,
  getOpenRouterFetch,
} from "@/server/lib/openrouter";
import { AgentAvailabilityService } from "../services/AgentAvailabilityService";

// The agent's model, as OpenSEO builds SAM's (buildSamChatModel): Think's
// getModel() is sync and runs before a turn has loaded its session, so the
// model it returns resolves, on each call, the organization the call is for
// and the model that organization's workspace picked, and only then reaches
// the gateway's AI proxy for that organization. Each answer is read for
// what it says about the model's setup (AgentAvailabilityService).

export type ModelChoice = { organizationId: string; modelId: string };

const NEVER_CALLED: typeof fetch = () =>
  Promise.reject(
    new Error("The agent's placeholder model was called directly."),
  );

export function buildCrmAgentModel(
  env: object,
  choose: () => Promise<ModelChoice | null>,
): LanguageModelV3 {
  const pick = async (): Promise<LanguageModelV3> => {
    const choice = await choose();
    if (!choice) throw new Error("This agent session no longer exists.");
    const gatewayFetch = getOpenRouterFetch(env, choice.organizationId);
    if (!gatewayFetch) {
      throw new Error(
        "AI gateway unavailable: the Every App gateway holds no OPENROUTER_API_KEY (in local development, set it in .dev.vars).",
      );
    }
    const { organizationId } = choice;
    const observed: typeof fetch = async (input, init) => {
      const response = await gatewayFetch(input, init);
      await withPgClient(() =>
        AgentAvailabilityService.noteModelResponse(organizationId, response),
      );
      return response;
    };
    return buildAgentModel(observed, choice.modelId);
  };
  return wrapLanguageModel({
    model: buildAgentModel(NEVER_CALLED, DEFAULT_AGENT_MODEL.id),
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ params }) => (await pick()).doGenerate(params),
      wrapStream: async ({ params }) => (await pick()).doStream(params),
    },
  });
}
