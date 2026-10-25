import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import {
  agentModelId,
  buildAgentModel,
  DEFAULT_AGENT_MODEL,
  getGatewayFetch,
} from "@/server/lib/gateway-ai";
import { AgentAvailabilityService } from "../services/AgentAvailabilityService";

// The agent's model, as OpenSEO builds SAM's (buildChatAgentModel): Think's
// getModel() is sync and runs before a turn has loaded its session, so the
// model it returns resolves, on each call, the organization the call is for,
// and only then reaches the gateway's default model for that organization.
// Each answer is read for what it says about the model's setup
// (AgentAvailabilityService). The default may be any provider, so no
// reasoning effort is sent: the operator's model reasons as it does by
// default.

export type ModelChoice = { organizationId: string };

const NEVER_CALLED: typeof fetch = () =>
  Promise.reject(
    new Error("The agent's placeholder model was called directly."),
  );

/** The agent's model for `choose`'s session. */
export function buildCrmAgentModel(
  env: object,
  choose: () => Promise<ModelChoice | null>,
): LanguageModelV3 {
  const pick = async (): Promise<LanguageModelV3> => {
    const choice = await choose();
    if (!choice) throw new Error("This agent session no longer exists.");
    const gatewayFetch = getGatewayFetch(env, choice.organizationId);
    if (!gatewayFetch) {
      throw new Error(
        "AI gateway unavailable: no Every App gateway binding (in local development, set OPENROUTER_API_KEY or another model provider's key in .dev.vars).",
      );
    }
    const { organizationId } = choice;
    const observed: typeof fetch = async (input, init) => {
      const response = await gatewayFetch(input, init);
      await AgentAvailabilityService.noteModelResponse(
        organizationId,
        response,
      );
      return response;
    };
    return buildAgentModel(observed, await agentModelId());
  };
  return wrapLanguageModel({
    model: buildAgentModel(NEVER_CALLED, DEFAULT_AGENT_MODEL),
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ params }) => (await pick()).doGenerate(params),
      wrapStream: async ({ params }) => (await pick()).doStream(params),
    },
  });
}
