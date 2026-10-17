import { beforeEach, describe, expect, it, vi } from "vitest";

// Changing a deployed agent from its page, on both backends: taking access
// away goes live at once, as do edited instructions; a record it didn't have,
// or an edited manifest, is checked as a draft is and waits for review.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: testDb.modules.workers.env,
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { recordResources } from "@/shared/team-agents";
import { AgentFileRepository } from "../repositories/AgentFileRepository";
import { TriggerRepository } from "../repositories/TriggerRepository";
import { AgentRevisionService } from "./AgentRevisionService";
import { draft, live, outsider, owner } from "./teamAgentTestSupport";
import { TeamAgentService } from "./TeamAgentService";

type Agent = Awaited<ReturnType<typeof TeamAgentService.get>>;

const records = (version: Agent["currentVersion"]) => {
  if (!version?.readable) throw new Error("No readable version");
  return recordResources(version.manifest.dataScope.resources).map(
    (record) => record.label,
  );
};

const versionOf = (
  outcome: Awaited<ReturnType<typeof AgentRevisionService.saveFiles>>,
) => {
  if (!outcome.saved) throw new Error(outcome.issues.join(" "));
  return outcome.versionId;
};

const file = async (versionId: string, path: string) => {
  const files = await AgentFileRepository.versionFiles("org_a", versionId);
  const found = files.find((row) => row.path === path);
  if (!found) throw new Error(`No ${path}`);
  return found;
};

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`agent revisions (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('globex', 'org_a', 'Globex');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('renewal', 'org_a', 'Renewal', 'globex', 'user_a');
      `);
    });

    it("makes a record the agent didn't have wait for review, and takes one away at once", async () => {
      const renewal = { kind: "deal" as const, id: "renewal" };
      const { agentId } = await live(
        draft({
          recordScope: "SELECTED",
          resources: [{ ...renewal, label: "Renewal" }],
        }),
        [renewal],
      );
      const added = versionOf(
        await AgentRevisionService.revise(owner, {
          agentId,
          clientRequestId: crypto.randomUUID(),
          resources: [
            { ...renewal, label: "Renewal" },
            { kind: "company", id: "globex", label: "globex" },
          ],
        }),
      );
      let agent = await TeamAgentService.get(owner, agentId);
      expect(records(agent.currentVersion)).toEqual(["Renewal"]);
      expect(agent.reviewVersion?.id).toBe(added);
      expect(records(agent.reviewVersion)).toEqual(["Renewal", "Globex"]);
      // Its triggers stay off until a person deploys it.
      const triggers = await TriggerRepository.triggersForVersion(
        "org_a",
        added,
      );
      expect(triggers.map((trigger) => trigger.enabled)).toEqual([false]);

      await TeamAgentService.deploy(owner, {
        agentId,
        versionId: added,
        clientRequestId: crypto.randomUUID(),
      });
      const narrowed = await AgentRevisionService.revise(owner, {
        agentId,
        clientRequestId: crypto.randomUUID(),
        resources: [{ kind: "company", id: "globex", label: "Globex" }],
      });
      expect(narrowed).toMatchObject({ saved: true, review: false });
      agent = await TeamAgentService.get(owner, agentId);
      expect(records(agent.currentVersion)).toEqual(["Globex"]);
      expect(agent.reviewVersion).toBeNull();
    });

    it("saves edited instructions at once and holds an edited manifest for review", async () => {
      const { agentId } = await live();
      const instructions =
        "When a deal changes stage, write two lines on where it stands and what changed.";
      const edited = versionOf(
        await AgentRevisionService.saveFiles(owner, {
          agentId,
          clientRequestId: crypto.randomUUID(),
          files: [{ path: "agent/instructions.md", content: instructions }],
        }),
      );
      expect(
        (await TeamAgentService.get(owner, agentId)).currentVersion?.id,
      ).toBe(edited);
      expect(await file(edited, "agent/instructions.md")).toMatchObject({
        content: `${instructions}\n`,
        previousContent: `${draft().instructions}\n`,
        revision: 2,
      });

      const manifest: unknown = JSON.parse(
        (await file(edited, "agent/manifest.json")).content,
      );
      const edit = (change: object) => ({
        agentId,
        clientRequestId: crypto.randomUUID(),
        files: [
          {
            path: "agent/manifest.json",
            content: JSON.stringify(Object.assign({}, manifest, change)),
          },
        ],
      });
      expect(
        await AgentRevisionService.saveFiles(
          owner,
          edit({
            dataScope: { mode: "SELECTED", summary: "", resources: [] },
          }),
        ),
      ).toEqual({
        saved: false,
        issues: ["Selected CRM scope needs at least one tagged record."],
      });

      const request = edit({
        description: "Summarizes every deal that moves.",
      });
      const proposed = await AgentRevisionService.saveFiles(owner, request);
      expect(proposed).toMatchObject({ saved: true, review: true });
      // The same request again changes nothing.
      expect(await AgentRevisionService.saveFiles(owner, request)).toEqual(
        proposed,
      );
      const agent = await TeamAgentService.get(owner, agentId);
      expect(agent.currentVersion?.id).toBe(edited);
      expect(agent.reviewVersion).toMatchObject({
        id: versionOf(proposed),
        manifest: { description: "Summarizes every deal that moves." },
      });
      await expect(
        AgentRevisionService.saveFiles(outsider, request),
      ).rejects.toThrow("NOT_FOUND");
    });
  });
}
