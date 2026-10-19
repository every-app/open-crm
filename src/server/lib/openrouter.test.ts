import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

// As OpenSEO's openrouter.test.ts: where OpenRouter would reject OpenAI, the
// agent's calls go to MiniMax M3 instead. Whichever model answers, the call
// asks for providers that keep and collect nothing.

const completion = () =>
  Response.json({
    choices: [
      {
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
  });

// The egress country is cached per module (one lookup per isolate), so each
// test needs a fresh module to run its own lookup.
beforeEach(() => {
  vi.resetModules();
});

const requestBody = z.object({
  model: z.string(),
  provider: z.record(z.string(), z.unknown()),
});

/** What the gateway was sent for one call to `model`. */
async function sent(model: (gatewayFetch: typeof fetch) => LanguageModelV3) {
  const gatewayFetch = vi.fn<typeof fetch>(async () => completion());
  await generateText({ model: model(gatewayFetch), prompt: "hi" });
  return requestBody.parse(
    JSON.parse(z.string().parse(gatewayFetch.mock.calls[0]?.[1]?.body)),
  );
}

async function requestedAgentCall(trace: () => Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(trace);
  const { buildAgentModel, DEFAULT_AGENT_MODEL } = await import("./openrouter");
  return sent((gatewayFetch) =>
    buildAgentModel(gatewayFetch, DEFAULT_AGENT_MODEL, "max"),
  );
}

const PRIVATE = { data_collection: "deny", zdr: true };

it("sends OpenAI calls to MiniMax M3 from a country where OpenAI is blocked", async () => {
  expect(
    await requestedAgentCall(async () => new Response("colo=HKG\nloc=HK\n")),
  ).toEqual({
    model: "minimax/minimax-m3",
    provider: {
      order: ["together", "atlas-cloud/fp8"],
      allow_fallbacks: true,
      ...PRIVATE,
    },
  });
});

it("stays on OpenAI when the country lookup fails", async () => {
  expect(
    await requestedAgentCall(async () => {
      throw new Error("offline");
    }),
  ).toEqual({ model: "openai/gpt-6-luna", provider: PRIVATE });
});
