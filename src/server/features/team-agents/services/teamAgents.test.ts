import { AgentActionRepository } from "@/server/features/team-agents/repositories/AgentActionRepository";
import { AgentFileRepository } from "@/server/features/team-agents/repositories/AgentFileRepository";
import { TriggerRepository } from "@/server/features/team-agents/repositories/TriggerRepository";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Team agents end to end on both backends, below the runtime: a builder
// chat's saved version waits for a person to deploy it; runs are queued once
// per request, schedule slot and event; a stop settles the run with what it
// had outstanding; and nothing crosses organizations.
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

import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { CAPTURE_GRANTS, captureGrants } from "@/shared/team-agents";
import { RunActions } from "../runtime/runActions";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { AgentRevisionService } from "./AgentRevisionService";
import { AgentRunService } from "./AgentRunService";
import { BuilderService } from "./BuilderService";
import { BuilderToolService } from "./BuilderToolService";
import {
  draft,
  live,
  member,
  outsider,
  owner,
  saved,
} from "./teamAgentTestSupport";
import { TeamAgentService } from "./TeamAgentService";
import { TriggerService } from "./TriggerService";

const google = (accountEmail: string) => ({
  provider: "google" as const,
  accountEmail,
  sources: ["gmail" as const],
});

const countRow = z.object({ n: z.coerce.number() });

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`team agents (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@a.test', true);
        INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_c', 'org_a', 'user_c', 'member', '2026-01-01T00:00:00.000Z');
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('renewal', 'org_a', 'Renewal', 'acme', 'user_a');
      `);
    });

    const runs = async () =>
      countRow.parse(
        (await database.rows("SELECT count(*) AS n FROM agent_run"))[0],
      ).n;

    it("keeps a saved version from running until a person deploys it", async () => {
      const version = await saved(draft());
      const request = {
        agentId: version.agentId,
        clientRequestId: crypto.randomUUID(),
      };
      await expect(AgentRunService.runNow(owner, request)).rejects.toThrow(
        "TEAM_AGENT_NOT_LIVE",
      );
      // A draft is its creator's alone.
      await expect(
        TeamAgentService.get(member, version.agentId),
      ).rejects.toThrow("NOT_FOUND");

      await TeamAgentService.deploy(owner, {
        agentId: version.agentId,
        versionId: version.versionId,
        clientRequestId: crypto.randomUUID(),
      });
      const run = await AgentRunService.runNow(member, request);
      expect(await AgentRunService.runNow(member, request)).toEqual(run);
      await expect(
        AgentRunService.runNow(member, {
          ...request,
          clientRequestId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("TEAM_AGENT_BUSY");
      expect(await runs()).toBe(1);
    });

    it("saves a selected scope only from records tagged in the chat", async () => {
      const chat = await BuilderRepository.createConversation({
        organizationId: "org_a",
        userId: "user_a",
        sessionId: `chat.test.${crypto.randomUUID()}`,
      });
      const input = draft({
        recordScope: "SELECTED",
        resources: [{ kind: "deal", id: "renewal", label: "Renewal" }],
      });
      const tool = {
        organizationId: "org_a",
        userId: "user_a",
        conversationId: chat.id,
        taggedIntegrations: [],
      };
      const untagged = await BuilderToolService.saveDraft(
        { ...tool, tagged: [] },
        input,
      );
      expect(untagged).toMatchObject({
        saved: false,
        issues: ["Renewal was not tagged in this builder chat."],
      });
      const tagged = await BuilderToolService.saveDraft(
        { ...tool, tagged: [{ kind: "deal", id: "renewal" }] },
        input,
      );
      expect(tagged).toMatchObject({ saved: true, status: "READY" });
    });

    it("grants captured email once the workspace has a mailbox, and a revision can take it away", async () => {
      const reading = draft({ integrations: ["email"] });
      // Another organization's mailbox doesn't count.
      await seedMailbox({ ...outsider, ...google("bo@b.test") });
      await expect(saved(reading)).rejects.toThrow(
        "nobody in this workspace has connected a mailbox",
      );
      await seedMailbox({ ...owner, ...google("ana@a.test") });
      const version = await live(reading);
      const grants = async () => {
        const agent = await TeamAgentService.get(owner, version.agentId);
        const shown = agent.currentVersion;
        if (!shown?.readable) throw new Error("No readable deployed version");
        return {
          grants: captureGrants(shown.manifest.dataScope.resources),
          access: shown.manifest.access,
        };
      };
      expect(await grants()).toEqual({
        grants: { email: true, calendar: false },
        access: ["Read workspace CRM records", CAPTURE_GRANTS.email.access],
      });
      await AgentRevisionService.revise(owner, {
        agentId: version.agentId,
        clientRequestId: crypto.randomUUID(),
        sources: [],
      });
      expect(await grants()).toEqual({
        grants: { email: false, calendar: false },
        access: ["Read workspace CRM records"],
      });
    });

    it("queues one run per live agent listening for an event", async () => {
      const listener = draft({
        recordScope: "WORKSPACE",
        triggers: [
          {
            type: "EVENT",
            name: "Stage moves",
            summary: "When a deal changes stage",
            event: "deal.stage.changed",
          },
        ],
      });
      const watching = await live(listener);
      const paused = await live(listener);
      await TeamAgentService.transition(owner, paused.agentId, "pause");
      await live(draft());

      expect(
        await TriggerService.emitEvent("org_a", {
          type: "deal.stage.changed",
          recordId: "renewal",
          data: { from: "DEMO_BOOKED", to: "CONTRACT_SENT" },
        }),
      ).toBe(1);
      const [run] = await AgentRunRepository.listForAgent(
        "org_a",
        watching.agentId,
        5,
      );
      expect(run).toMatchObject({
        status: "QUEUED",
        triggerType: "EVENT",
        input: { record: { kind: "deal", id: "renewal" } },
      });
      expect(await runs()).toBe(1);
    });

    it("makes one run of a due schedule slot across overlapping ticks", async () => {
      const version = await live(
        draft({
          triggers: [
            {
              type: "SCHEDULE",
              name: "Mondays",
              summary: "Every Monday morning",
              nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
              intervalMinutes: 10_080,
            },
          ],
        }),
      );
      const due = "2026-01-05T09:00:00.000Z";
      await database.exec(`UPDATE agent_trigger SET next_run_at = '${due}'`);

      const now = new Date();
      const queued = await Promise.all([
        TriggerService.queueDueSchedules(now),
        TriggerService.queueDueSchedules(now),
      ]);
      expect(queued[0] + queued[1]).toBe(1);
      expect(await TriggerService.queueDueSchedules(now)).toBe(0);
      expect(await runs()).toBe(1);
      const [trigger] = await TriggerRepository.triggersForVersion(
        "org_a",
        version.versionId,
      );
      expect(trigger?.lastRunAt).toBe(due);
      expect(trigger?.nextRunAt && trigger.nextRunAt > now.toISOString()).toBe(
        true,
      );
    });

    it("settles a stopped run with its outstanding actions, and its tools refuse after", async () => {
      const version = await live();
      const { id: runId } = await AgentRunService.runNow(owner, {
        agentId: version.agentId,
        clientRequestId: crypto.randomUUID(),
      });
      expect(await AgentRunRepository.claim("org_a", runId, "model")).toBe(
        true,
      );
      const action = await AgentActionRepository.planAction({
        organizationId: "org_a",
        agentId: version.agentId,
        runId,
        type: "slack.message.post",
        provider: "slack",
        targetType: "channel",
        targetId: "C1",
        targetLabel: "#sales",
        summary: "Post",
        metadata: null,
        idempotencyKey: `${runId}:call_1`,
        requestHash: "h",
      });
      expect(
        await AgentActionRepository.claimAction("org_a", action.id, 60_000),
      ).not.toBeNull();

      // Only whoever started it, its creator or an admin may stop it.
      await expect(
        AgentRunService.cancelRun(member, { agentId: version.agentId, runId }),
      ).rejects.toThrow("FORBIDDEN");
      expect(
        await AgentRunService.cancelRun(owner, {
          agentId: version.agentId,
          runId,
        }),
      ).toMatchObject({ cancelled: true });
      expect(
        await AgentRunService.cancelRun(owner, {
          agentId: version.agentId,
          runId,
        }),
      ).toMatchObject({ cancelled: false });

      expect(await AgentRunRepository.findById("org_a", runId)).toMatchObject({
        status: "CANCELLED",
        errorCode: "CANCELLED",
      });
      const [settledAction] = await AgentActionRepository.actionsForRuns(
        "org_a",
        [runId],
      );
      expect(settledAction?.status).toBe("CANCELLED");
      const [history] = await AgentRunService.history(
        owner,
        version.agentId,
        5,
      );
      expect(history?.events.map((event) => event.type)).toEqual([
        "run.queued",
        "run.cancelled",
      ]);
      const activity = await TeamAgentService.activity(
        owner,
        version.agentId,
        20,
      );
      expect(activity.map((event) => event.type)).toContain("run.cancelled");
      await expect(
        RunActions.stageResult("org_a", runId, { summary: "Done" }),
      ).rejects.toThrow("not active");
    });

    it("keeps one organization's agents and runs out of another's reach", async () => {
      const version = await live();
      const { id: runId } = await AgentRunService.runNow(owner, {
        agentId: version.agentId,
        clientRequestId: crypto.randomUUID(),
      });
      expect(await TeamAgentService.list(outsider)).toEqual([]);
      expect(await BuilderService.listConversations(outsider)).toEqual([]);
      await expect(
        TeamAgentService.get(outsider, version.agentId),
      ).rejects.toThrow("NOT_FOUND");
      await expect(
        AgentRunService.runNow(outsider, {
          agentId: version.agentId,
          clientRequestId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("NOT_FOUND");
      await expect(
        AgentRunService.cancelRun(outsider, {
          agentId: version.agentId,
          runId,
        }),
      ).rejects.toThrow("NOT_FOUND");
      expect(await AgentRunRepository.findById("org_b", runId)).toBeNull();
      expect(
        await AgentFileRepository.versionFiles("org_b", version.versionId),
      ).toEqual([]);
      expect(
        await TriggerService.emitEvent("org_b", {
          type: "deal.created",
          recordId: "renewal",
          data: {},
        }),
      ).toBe(0);
    });
  });
}
