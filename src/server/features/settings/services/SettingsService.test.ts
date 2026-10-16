import { beforeEach, describe, expect, it, vi } from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));

import { DEFAULT_AGENT_MODEL } from "@/server/lib/openrouter";
import { SettingsService } from "./SettingsService";

const fetchMock = vi.fn<typeof fetch>();

const catalogModel = (id: string, supportedParameters: string[]) => ({
  id,
  name: id,
  context_length: 128_000,
  pricing: { prompt: "0.000001", completion: "0.000002" },
  supported_parameters: supportedParameters,
});

beforeEach(async () => {
  await testDb.exec(
    `DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
  );
  await testDb.seedTwoOrganizations();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () =>
    Response.json({
      data: [
        catalogModel("acme/agent", ["tools", "temperature"]),
        catalogModel("acme/chat", ["temperature"]),
      ],
    }),
  );
});

describe("SettingsService.setAgentModel", () => {
  it("takes only tool-using models from OpenRouter's catalog, and goes back to the default", async () => {
    expect(await SettingsService.setAgentModel("org_a", "acme/agent")).toEqual({
      id: "acme/agent",
      contextWindowTokens: 128_000,
      isDefault: false,
      defaultId: DEFAULT_AGENT_MODEL.id,
    });
    await expect(
      SettingsService.setAgentModel("org_a", "acme/chat"),
    ).rejects.toThrow(
      'OpenRouter serves no tool-using model called "acme/chat"',
    );
    expect(await SettingsService.getAgentModel("org_b")).toMatchObject({
      id: DEFAULT_AGENT_MODEL.id,
      isDefault: true,
    });

    expect(await SettingsService.setAgentModel("org_a", null)).toMatchObject({
      id: DEFAULT_AGENT_MODEL.id,
      isDefault: true,
    });
  });
});
