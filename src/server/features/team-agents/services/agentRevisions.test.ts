import { beforeEach, describe, expect, it, vi } from "vitest";

// Changing a deployed agent from its page: taking access
// away goes live at once, as do edited instructions; a record it didn't have,
// or an edited manifest, is checked as a draft is and waits for review; and
// each change builds on the version waiting for review.
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

import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { recordResources, slackDestinationOf } from "@/shared/team-agents";
import { AgentFileRepository } from "../repositories/AgentFileRepository";
import { AgentVersionRepository } from "../repositories/AgentVersionRepository";
import { TriggerRepository } from "../repositories/TriggerRepository";
import { AgentRevisionService } from "./AgentRevisionService";
import type { DraftInput } from "./draft";
import { draft, live, outsider, owner } from "./teamAgentTestSupport";
import { TeamAgentService } from "./TeamAgentService";

type Agent = Awaited<ReturnType<typeof TeamAgentService.get>>;

const records = (version: Agent["currentVersion"]) => {
  if (!version?.readable) throw new Error("No readable version");
  return recordResources(version.manifest.dataScope.resources).map(
    (record) => record.label,
  );
};

const actions = (version: Agent["currentVersion"]) => {
  if (!version?.readable) throw new Error("No readable version");
  return version.manifest.actions.map((action) => action.type);
};

const versionOf = (
  outcome: Awaited<ReturnType<typeof AgentRevisionService.saveFiles>>,
) => {
  if (!outcome.saved) throw new Error(outcome.issues.join(" "));
  return outcome.versionId;
};

const renewal = { kind: "deal" as const, id: "renewal", label: "Renewal" };
const globex = { kind: "company" as const, id: "globex", label: "Globex" };

/** Slack connected, with #sales (C1) and #deals (C2). */
const slackConnected = () => `
  INSERT INTO slack_connection (id, organization_id, team_id, bot_token, bot_scopes, synced_at) VALUES ('slack', 'org_a', 'T1', 'xoxb-test', 'chat:write', '${new Date().toISOString()}');
  INSERT INTO slack_channel (id, organization_id, slack_channel_id, name) VALUES ('sales', 'org_a', 'C1', 'sales'), ('deals', 'org_a', 'C2', 'deals');
`;

/** A run summary, posted to #sales. */
const postsToSales: DraftInput["actions"] = [
  { type: "run.summary", provider: "crm", summary: "Summarize" },
  {
    type: "slack.message.post",
    provider: "slack",
    summary: "Post the summary",
    destination: {
      kind: "channel",
      resolution: "chosen",
      id: "C1",
      label: "#sales",
    },
  },
];

const file = async (versionId: string, path: string) => {
  const files = await AgentFileRepository.versionFiles("org_a", versionId);
  const found = files.find((row) => row.path === path);
  if (!found) throw new Error(`No ${path}`);
  return found;
};

describe("agent revisions", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('globex', 'org_a', 'Globex');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('renewal', 'org_a', 'Renewal', 'globex', 'user_a');
      `);
    vi.spyOn(SlackInventoryService, "joinChannel").mockResolvedValue({
      outcome: "joined",
    });
  });

  it("builds each change on the version waiting for review, keeps it waiting when a change goes live at once, and leaves nothing waiting once it is taken back", async () => {
    await database.exec(
      `INSERT INTO company (id, organization_id, name) VALUES ('initech', 'org_a', 'Initech');`,
    );
    const initech = {
      kind: "company" as const,
      id: "initech",
      label: "Initech",
    };
    const { agentId } = await live(
      draft({
        recordScope: "SELECTED",
        resources: [renewal],
        actions: [
          { type: "run.summary", provider: "crm", summary: "Summarize" },
          {
            type: "crm.activity.create",
            provider: "crm",
            summary: "Note what moved",
            activityTypes: ["NOTE"],
          },
        ],
      }),
      [renewal],
    );
    const revise = (change: object) =>
      AgentRevisionService.revise(owner, {
        agentId,
        clientRequestId: crypto.randomUUID(),
        ...change,
      });

    await revise({ resources: [renewal, globex] });
    await revise({ resources: [renewal, globex, initech] });
    let agent = await TeamAgentService.get(owner, agentId);
    expect(records(agent.reviewVersion)).toEqual([
      "Renewal",
      "Globex",
      "Initech",
    ]);
    expect(
      await AgentVersionRepository.reviewVersion("org_b", agentId, null),
    ).toBeNull();

    expect(await revise({ actions: ["run.summary"] })).toMatchObject({
      saved: true,
      review: false,
    });
    agent = await TeamAgentService.get(owner, agentId);
    expect(records(agent.currentVersion)).toEqual(["Renewal"]);
    expect(actions(agent.currentVersion)).toEqual(["run.summary"]);
    expect(records(agent.reviewVersion)).toEqual([
      "Renewal",
      "Globex",
      "Initech",
    ]);
    expect(actions(agent.reviewVersion)).toEqual(["run.summary"]);

    expect(await revise({ resources: [renewal] })).toMatchObject({
      saved: true,
      review: false,
    });
    agent = await TeamAgentService.get(owner, agentId);
    expect(agent.reviewVersion).toBeNull();
    expect(records(agent.currentVersion)).toEqual(["Renewal"]);
    expect(agent.triggers.map((trigger) => trigger.enabled)).toEqual([true]);
  });

  it("puts an instructions edit live at once and on the version waiting for review", async () => {
    const { agentId } = await live(
      draft({ recordScope: "SELECTED", resources: [renewal] }),
      [renewal],
    );
    await AgentRevisionService.revise(owner, {
      agentId,
      clientRequestId: crypto.randomUUID(),
      resources: [renewal, globex],
    });
    const instructions =
      "When a deal changes stage, write two lines on where it stands and what changed.";
    const saved = await AgentRevisionService.saveFiles(owner, {
      agentId,
      clientRequestId: crypto.randomUUID(),
      files: [{ path: "agent/instructions.md", content: instructions }],
    });
    expect(saved).toMatchObject({ saved: true, review: false });
    const agent = await TeamAgentService.get(owner, agentId);
    for (const version of [agent.currentVersion, agent.reviewVersion]) {
      if (!version) throw new Error("No version");
      expect((await file(version.id, "agent/instructions.md")).content).toBe(
        `${instructions}\n`,
      );
    }
    expect(records(agent.reviewVersion)).toEqual(["Renewal", "Globex"]);
  });

  it("joins the channel a move that waited for review moved to once it is deployed", async () => {
    await database.exec(slackConnected());
    const { agentId } = await live(
      draft({
        recordScope: "SELECTED",
        resources: [renewal],
        integrations: ["slack"],
        actions: postsToSales,
      }),
      [renewal],
    );
    const moved = await AgentRevisionService.revise(owner, {
      agentId,
      clientRequestId: crypto.randomUUID(),
      channel: { id: "C2", name: "deals" },
      resources: [renewal, globex],
    });
    expect(moved).toMatchObject({ saved: true, review: true });
    expect(SlackInventoryService.joinChannel).not.toHaveBeenCalled();

    await TeamAgentService.deploy(owner, {
      agentId,
      versionId: versionOf(moved),
      clientRequestId: crypto.randomUUID(),
    });
    expect(SlackInventoryService.joinChannel).toHaveBeenCalledWith(owner, "C2");
  });

  it("makes a record the agent didn't have wait for review, and takes one away at once", async () => {
    const { agentId } = await live(
      draft({ recordScope: "SELECTED", resources: [renewal] }),
      [renewal],
    );
    const added = versionOf(
      await AgentRevisionService.revise(owner, {
        agentId,
        clientRequestId: crypto.randomUUID(),
        resources: [renewal, { ...globex, label: "globex" }],
      }),
    );
    let agent = await TeamAgentService.get(owner, agentId);
    expect(records(agent.currentVersion)).toEqual(["Renewal"]);
    expect(agent.reviewVersion?.id).toBe(added);
    expect(records(agent.reviewVersion)).toEqual(["Renewal", "Globex"]);
    // Its triggers stay off until a person deploys it.
    const triggers = await TriggerRepository.triggersForVersion("org_a", added);
    expect(triggers.map((trigger) => trigger.enabled)).toEqual([false]);

    await TeamAgentService.deploy(owner, {
      agentId,
      versionId: added,
      clientRequestId: crypto.randomUUID(),
    });
    const narrowed = await AgentRevisionService.revise(owner, {
      agentId,
      clientRequestId: crypto.randomUUID(),
      resources: [globex],
    });
    expect(narrowed).toMatchObject({ saved: true, review: false });
    agent = await TeamAgentService.get(owner, agentId);
    expect(records(agent.currentVersion)).toEqual(["Globex"]);
    expect(agent.reviewVersion).toBeNull();
  });

  it("narrows a workspace-wide agent to chosen records at once, unless an event trigger needs the workspace", async () => {
    const { agentId } = await live();
    const narrowed = await AgentRevisionService.revise(owner, {
      agentId,
      clientRequestId: crypto.randomUUID(),
      resources: [globex],
    });
    expect(narrowed).toMatchObject({ saved: true, review: false });
    const agent = await TeamAgentService.get(owner, agentId);
    expect(records(agent.currentVersion)).toEqual(["Globex"]);
    expect(agent.reviewVersion).toBeNull();

    const { agentId: watcher } = await live(
      draft({
        triggers: [
          {
            type: "EVENT",
            name: "On close",
            summary: "When a deal closes",
            event: "deal.closed",
          },
        ],
      }),
    );
    await expect(
      AgentRevisionService.revise(owner, {
        agentId: watcher,
        clientRequestId: crypto.randomUUID(),
        resources: [globex],
      }),
    ).rejects.toThrow("Event triggers need workspace CRM scope.");
  });

  it("keeps a deployed agent's Slack channel, renamed since, when a change waits for review", async () => {
    await database.exec(slackConnected());
    const { agentId, versionId } = await live(
      draft({ integrations: ["slack"], actions: postsToSales }),
    );
    await database.exec(
      `UPDATE slack_channel SET name = 'sales-team' WHERE id = 'sales';`,
    );
    const manifest: unknown = JSON.parse(
      (await file(versionId, "agent/manifest.json")).content,
    );

    const proposed = await AgentRevisionService.saveFiles(owner, {
      agentId,
      clientRequestId: crypto.randomUUID(),
      files: [
        {
          path: "agent/manifest.json",
          content: JSON.stringify(
            Object.assign({}, manifest, { description: "Posts to Slack." }),
          ),
        },
      ],
    });
    expect(proposed).toMatchObject({ saved: true, review: true });
    const review = (await TeamAgentService.get(owner, agentId)).reviewVersion;
    if (!review?.readable) throw new Error("No readable review version");
    expect(slackDestinationOf(review.manifest)?.label).toBe("#sales-team");
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
