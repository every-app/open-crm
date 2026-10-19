import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it, vi } from "vitest";
import { openRouterCostUsd, staticAssistantModel } from "./chatAgent";

// A response's cost is what OpenRouter reports with it. One that reports none
// is billed $0, as it always was, and logged with the model that sent it; a
// static reply calls no provider, so it costs nothing and logs nothing.

it("bills a response with no cost at $0 and names its model, but not a static reply", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const uncosted = await generateText({
    model: new MockLanguageModelV3({
      modelId: "openai/gpt-6-luna",
      doGenerate: {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        warnings: [],
      },
    }),
    prompt: "hi",
  });
  const gated = await generateText({
    model: staticAssistantModel("You're out of credits."),
    prompt: "hi",
  });
  expect([openRouterCostUsd(uncosted), openRouterCostUsd(gated)]).toEqual([
    0, 0,
  ]);
  expect(warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
    model: "openai/gpt-6-luna",
  });
});
