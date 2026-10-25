import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { asker, NO_OPENROUTER_KEY, webResearchAccess } from "./perplexity";

// Sonar answers through the gateway's OpenRouter proxy; an answer is only as
// good as its citations, which arrive as OpenRouter's url_citation
// annotations, Perplexity's own citations list, or both. The proxy is stubbed.

const sent = z.object({
  model: z.string(),
  provider: z.record(z.string(), z.unknown()),
  plugins: z
    .array(z.object({ id: z.string(), include_domains: z.array(z.string()) }))
    .optional(),
});

function gateway(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
  const body = () =>
    sent.parse(JSON.parse(z.string().parse(fetch.mock.calls[0]?.[1]?.body)));
  return { fetch, body };
}

const completion = {
  id: "gen-1",
  object: "chat.completion",
  created: 1,
  model: "perplexity/sonar",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "Fernhill raised a Series B in March.",
        annotations: [
          {
            type: "url_citation",
            url_citation: {
              url: "https://news.test/fernhill-series-b",
              title: "Fernhill raises",
              start_index: 0,
              end_index: 10,
            },
          },
        ],
      },
    },
  ],
  citations: [
    "https://news.test/fernhill-series-b",
    "https://fernhill.test/blog/series-b",
  ],
  usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
};

describe("asking Sonar", () => {
  it("keeps every citation, however it comes back", async () => {
    const { fetch, body } = gateway(Response.json(completion));
    expect(
      await asker(fetch)("What has Fernhill announced?", {
        domains: ["fernhill.test"],
      }),
    ).toEqual({
      ok: true,
      data: {
        text: "Fernhill raised a Series B in March.",
        citations: [
          "https://news.test/fernhill-series-b",
          "https://fernhill.test/blog/series-b",
        ],
      },
    });
    expect(body()).toEqual({
      model: "perplexity/sonar",
      provider: { data_collection: "deny", zdr: true },
      plugins: [{ id: "web", include_domains: ["fernhill.test"] }],
    });
  });

  it("asks Sonar Pro for a deep question, and reports a refusal rather than throwing", async () => {
    const deep = gateway(Response.json(completion));
    await asker(deep.fetch)("Prepare a brief on Fernhill.", { deep: true });
    expect(deep.body().model).toBe("perplexity/sonar-pro");

    const refused = gateway(
      Response.json(
        { error: { message: "Insufficient credits" } },
        { status: 402 },
      ),
    );
    expect(await asker(refused.fetch)("Anything?")).toMatchObject({
      ok: false,
    });
  });

  // Last: the refusal is remembered for the rest of this module's isolate.
  it("says web research is unavailable when the gateway holds no OpenRouter key, and stops offering it", async () => {
    const missing = gateway(
      Response.json(
        {
          code: "ai_provider_not_configured",
          message:
            "Provider is not configured: the gateway needs OPENROUTER_API_KEY for openrouter.",
        },
        {
          status: 503,
          headers: { "x-everyapp-error": "ai_provider_not_configured" },
        },
      ),
    );
    expect(await asker(missing.fetch)("Anything?")).toEqual({
      ok: false,
      reason: NO_OPENROUTER_KEY,
    });
    expect(await webResearchAccess()).toBeNull();
  });
});
