import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIORITY } from "@/shared/agent-tasks";

// Whether the agent's model can run is learned from the gateway's answers:
// a refusal for want of a key holds the organization's research, an answer
// clears it, and an old refusal is tried again. On both backends, since the
// dispatcher's hold is a subquery over text timestamps.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// The gateway binding is there; whether it holds a key is the question.
vi.mock("@/server/lib/openrouter", () => ({
  getOpenRouterFetch: () => fetch,
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasContextAccess: async () => false,
}));

import { AgentQueueRepository } from "../repositories/AgentQueueRepository";
import {
  AgentAvailabilityService,
  MODEL_RETRY_MS,
} from "./AgentAvailabilityService";

const refusal = () =>
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
  );

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const modelOf = async (organizationId: string) =>
  (await AgentAvailabilityService.forOrganization(organizationId)).model;

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`AgentAvailabilityService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await database.exec(
        `INSERT INTO workspace (organization_id, name) VALUES ('org_a', 'A'), ('org_b', 'B');
         INSERT INTO agent_task (id, organization_id, kind, reason, priority, budget, subject, due_at)
         VALUES ('t_a', 'org_a', 'workspace-profile', 'test', ${PRIORITY.workspace}, 4, 'workspace', '2026-01-01T00:00:00.000Z'),
                ('t_b', 'org_b', 'workspace-profile', 'test', ${PRIORITY.workspace}, 4, 'workspace', '2026-01-01T00:00:00.000Z');`,
      );
    });

    const claim = async () =>
      (
        await AgentQueueRepository.claimDue({
          limit: 10,
          lane: { except: ["brand", "portrait"] },
          leaseMs: 60_000,
          heldSince: new Date(Date.now() - MODEL_RETRY_MS).toISOString(),
        })
      )
        .map((task) => task.id)
        .sort();

    it("holds an organization's research once the gateway refuses its model, and clears it when the model answers", async () => {
      expect(await modelOf("org_a")).toBe("unchecked");

      await AgentAvailabilityService.noteModelResponse("org_a", refusal());
      const availability =
        await AgentAvailabilityService.forOrganization("org_a");
      expect(availability.model).toBe("refused");
      expect(availability.modelRefusal).toContain("OPENROUTER_API_KEY");
      expect(await modelOf("org_b")).toBe("unchecked");
      // org_a's task waits; org_b's runs.
      expect(await claim()).toEqual(["t_b"]);

      await AgentAvailabilityService.noteModelResponse(
        "org_a",
        Response.json({ choices: [] }),
      );
      expect(await modelOf("org_a")).toBe("ready");
      expect(await claim()).toEqual(["t_a"]);
    });

    it("tries a refused model again after a while, and stops saying it is refused", async () => {
      await AgentAvailabilityService.noteModelResponse("org_a", refusal());
      await database.exec(
        `UPDATE workspace SET model_refused_at = '${ago(MODEL_RETRY_MS + 1000)}' WHERE organization_id = 'org_a'`,
      );
      // The dispatcher tries again, while screens still say it's refused.
      expect(await claim()).toEqual(["t_a", "t_b"]);
      expect(await modelOf("org_a")).toBe("refused");

      await database.exec(
        `UPDATE workspace SET model_refused_at = '${ago(60 * 60_000)}' WHERE organization_id = 'org_a'`,
      );
      expect(await modelOf("org_a")).toBe("unchecked");
    });
  });
}
