import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { subscribe } from "agents/observability";
import { z } from "zod";

// The chat agent's most common failure modes — a provider stream dying
// mid-turn ("chat:request:failed", stage "stream") and a DO restart whose
// recovery gives up ("chat:recovery:exhausted") — never reach an onChatError
// hook; their only signal is the agents:chat diagnostics channel, which is
// silent without a subscriber. This module-level subscription puts them in
// the Workers logs for every chat DO in the isolate. The user-visible residue
// of these is the replayed "Something went wrong" banner plus a
// partially-streamed assistant message.
subscribe("chat", (event) => {
  if (
    event.type === "chat:request:failed" ||
    event.type === "chat:recovery:exhausted"
  ) {
    console.error(
      `[chat] ${event.type}`,
      { agent: event.agent, name: event.name },
      event.payload,
    );
  }
});

// A model called through the gateway's pinned OpenRouter with usage
// accounting on reports the real USD cost of each response under
// providerMetadata.openrouter.usage.cost. The agent's own model is the
// gateway's default route, whose answers carry no cost the CRM can read: the
// gateway counts that spend (Manage workspace → Usage), so the step records
// none.
const openRouterUsageSchema = z.object({
  openrouter: z.object({ usage: z.object({ cost: z.number() }) }),
});

/** The model staticAssistantModel answers as: it calls no provider. */
const STATIC_MODEL_ID = "static-assistant";

/**
 * A model response's cost in USD, when the response reports one (a pinned
 * OpenRouter call); else null, counted by the gateway instead. A static
 * reply costs nothing.
 */
export function stepCostUsd(answer: {
  providerMetadata: unknown;
  response: { modelId: string };
}): number | null {
  const parsed = openRouterUsageSchema.safeParse(answer.providerMetadata);
  if (parsed.success) return parsed.data.openrouter.usage.cost;
  return answer.response.modelId === STATIC_MODEL_ID ? 0 : null;
}

// The provider package re-exports only LanguageModelV3 itself, so the stream
// shape is derived from the interface.
type StreamResult = Awaited<ReturnType<LanguageModelV3["doStream"]>>;

// Nothing is generated, so every counter is zero and there is no provider
// finish reason to report.
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const FINISH_STOP = { unified: "stop", raw: undefined } as const;

// A model that ignores its prompt and streams `text` back verbatim. Lets a
// Think agent answer a gated turn through the normal turn pipeline — streamed,
// persisted and rendered like any other assistant message — without ever
// calling a provider: no request, no tokens, and no reasoning channel that
// could leak a chain-of-thought instead of the reply.
export function staticAssistantModel(text: string): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "open-crm",
    modelId: STATIC_MODEL_ID,
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: FINISH_STOP,
      usage: NO_USAGE,
      warnings: [],
    }),
    doStream: async () => {
      const stream: StreamResult["stream"] = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "0" });
          controller.enqueue({ type: "text-delta", id: "0", delta: text });
          controller.enqueue({ type: "text-end", id: "0" });
          controller.enqueue({
            type: "finish",
            finishReason: FINISH_STOP,
            usage: NO_USAGE,
          });
          controller.close();
        },
      });
      return { stream };
    },
  };
}
