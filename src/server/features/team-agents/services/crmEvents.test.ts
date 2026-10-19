import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// CRM events: each is written in the batch of the record
// write that caused it, so a write that didn't land tells nothing, and the
// minute cron turns it into one run of each live agent listening, however
// many ticks overlap, and never another organization's.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);
// Events become runs here as on the minute cron, not in a poke after the write.
vi.mock("@/server/features/team-agents/runtime/poke", () => ({
  pokeEvents: vi.fn(),
  pokeRuns: vi.fn(),
}));

import { DealRepository } from "@/server/features/deals/repositories/DealRepository";
import { DealService } from "@/server/features/deals/services/DealService";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { draft, live, owner } from "./teamAgentTestSupport";
import { TeamAgentService } from "./TeamAgentService";
import { TriggerService } from "./TriggerService";

const countRow = z.object({ n: z.coerce.number() });
const reasonRow = z.object({ reason: z.string() });

const stageWatcher = draft({
  triggers: [
    {
      type: "EVENT",
      name: "Stage moves",
      summary: "When a deal changes stage",
      event: "deal.stage.changed",
    },
  ],
});

describe("CRM events", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme'), ('bolt', 'org_b', 'Bolt');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES
          ('renewal', 'org_a', 'Renewal', 'acme', 'user_a'), ('pilot', 'org_b', 'Pilot', 'bolt', 'user_b');
      `);
  });

  const runs = async () =>
    countRow.parse(
      (await database.rows("SELECT count(*) AS n FROM agent_run"))[0],
    ).n;
  const events = async () =>
    (
      await database.rows(
        "SELECT reason FROM agent_task WHERE kind = 'agent-event' ORDER BY reason",
      )
    ).map((row) => reasonRow.parse(row).reason);
  const tick = () => TriggerService.queueEventRuns();

  it("turns an event written with its record into one run of each live agent listening", async () => {
    const watching = await live(stageWatcher);
    const paused = await live(stageWatcher);
    await TeamAgentService.transition(owner, paused.agentId, "pause");
    await live(draft());

    await DealService.setStage(
      "org_a",
      { id: "renewal", stage: "CONTRACT_SENT" },
      "user_a",
    );
    // Another organization's move runs none of these agents.
    await DealService.setStage(
      "org_b",
      { id: "pilot", stage: "CONTRACT_SENT" },
      "user_b",
    );
    // Two ticks that overlap take each event once.
    const queued = await Promise.all([tick(), tick()]);
    expect(queued[0] + queued[1]).toBe(1);
    expect(await tick()).toBe(0);
    expect(await runs()).toBe(1);
    const [run] = await AgentRunRepository.listForAgent(
      "org_a",
      watching.agentId,
      5,
    );
    expect(run).toMatchObject({
      status: "QUEUED",
      triggerType: "EVENT",
      input: {
        event: {
          type: "deal.stage.changed",
          data: {
            companyId: "acme",
            from: "DEMO_BOOKED",
            to: "CONTRACT_SENT",
          },
        },
        record: { kind: "deal", id: "renewal" },
      },
    });
  });

  it("tells of each move a deal makes once, and of none that didn't land", async () => {
    const deal = await DealService.createDeal("org_a", {
      name: "Expansion",
      companyId: "acme",
      ownerId: "user_a",
      stage: "CLOSED_WON",
    });
    const won = { id: deal.id, stage: "CLOSED_WON" as const };
    await DealService.setStage("org_a", won, "user_a");
    await DealService.setStage(
      "org_a",
      { id: deal.id, stage: "QUALIFIED_TO_BUY" },
      "user_a",
    );
    // Someone else moved it first: the move from where it was lands nowhere.
    const stale = {
      companyId: "acme",
      from: "CLOSED_WON",
      to: "CLOSED_LOST",
    } as const;
    expect(
      await DealRepository.moveStage(
        "org_a",
        { ...stale, id: deal.id, reason: "Budget", movedById: "user_a" },
        [{ type: "deal.stage.changed", data: stale }],
      ),
    ).toBe(false);

    expect(await events()).toEqual([
      "deal.closed",
      "deal.created",
      "deal.opened",
      "deal.stage.changed",
    ]);
  });
});
