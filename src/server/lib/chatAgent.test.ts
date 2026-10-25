import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it } from "vitest";
import { staticAssistantModel, stepCostUsd } from "./chatAgent";

// A response's cost is what a pinned OpenRouter call reports with it. The
// gateway's default model route reports none the CRM can read (the gateway
// counts it), so it records null; a static reply calls no provider and costs
// nothing.

const answer = (providerMetadata?: Record<string, Record<string, never>>) =>
  generateText({
    model: new MockLanguageModelV3({
      modelId: "anthropic/claude-haiku-5.5",
      doGenerate: {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        warnings: [],
        ...(providerMetadata ? { providerMetadata } : {}),
      },
    }),
    prompt: "hi",
  });

it("reads OpenRouter's cost, records none for the default route, and $0 for a static reply", async () => {
  const pinned = await answer({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OpenRouter's usage metadata, as its provider reports it
    openrouter: { usage: { cost: 0.0123 } } as unknown as Record<string, never>,
  });
  const byDefault = await answer();
  const gated = await generateText({
    model: staticAssistantModel("This chat has run out of room."),
    prompt: "hi",
  });
  expect([
    stepCostUsd(pinned),
    stepCostUsd(byDefault),
    stepCostUsd(gated),
  ]).toEqual([0.0123, null, 0]);
});
