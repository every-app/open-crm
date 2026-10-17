import { generateText } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

// As OpenSEO's openrouter.test.ts: where OpenRouter would reject OpenAI, the
// agent's calls go to MiniMax M3 instead.

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

async function requestedModel(trace: () => Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(trace);
  const gatewayFetch = vi.fn<typeof fetch>(async () => completion());
  const { buildAgentModel, DEFAULT_AGENT_MODEL } = await import("./openrouter");
  await generateText({
    model: buildAgentModel(gatewayFetch, DEFAULT_AGENT_MODEL, "max"),
    prompt: "hi",
  });
  const body = z
    .object({ model: z.string() })
    .parse(JSON.parse(z.string().parse(gatewayFetch.mock.calls[0]?.[1]?.body)));
  return body.model;
}

it("sends OpenAI calls to MiniMax M3 from a country where OpenAI is blocked", async () => {
  expect(
    await requestedModel(async () => new Response("colo=HKG\nloc=HK\n")),
  ).toBe("minimax/minimax-m3");
});

it("stays on OpenAI when the country lookup fails", async () => {
  expect(
    await requestedModel(async () => {
      throw new Error("offline");
    }),
  ).toBe("openai/gpt-5.6-luna");
});
