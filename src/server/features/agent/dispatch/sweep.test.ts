import { sortBy } from "remeda";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The enrichment sweep's selection is new SQL (correlated NOT EXISTS, a left
// join, the claim's conditional update): both backends must pick the same
// records.
const { databases, current } = await vi.hoisted(async () => {
  const { createPgTestDb, createSqliteTestDb } =
    await import("@/server/testing/testDb");
  return {
    databases: {
      sqlite: await createSqliteTestDb(),
      postgres: await createPgTestDb(),
    },
    current: { dialect: "sqlite" as "sqlite" | "postgres" },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return current.dialect === "postgres" ? "postgres" : "d1";
    },
  },
}));
vi.mock("@/db", () => ({
  get db() {
    return databases[current.dialect].db;
  },
}));
vi.mock("@/db/runBatch", () => ({
  get executeInBatches() {
    return databases[current.dialect].runBatchModule.executeInBatches;
  },
}));
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { runEnrichmentSweep } from "./sweep";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const ready = async () => true;
const noKey = async () => false;

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`the enrichment sweep (${dialect})`, () => {
    const database = databases[dialect];

    beforeEach(async () => {
      current.dialect = dialect;
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM workspace_profile; DELETE FROM workspace; DELETE FROM contact; DELETE FROM company;
         DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await database.exec(
        `INSERT INTO workspace (organization_id, name) VALUES ('org_a', 'A'), ('org_b', 'B');`,
      );
    });

    /** Open tasks as `kind subject`, sorted. */
    async function queued(organizationId = "org_a") {
      const rows = await database.rows(
        `SELECT kind, subject FROM agent_task WHERE organization_id = '${organizationId}' AND finished_at IS NULL`,
      );
      return sortBy(
        rows.map((row) => `${String(row.kind)} ${String(row.subject)}`),
        (line) => line,
      );
    }

    async function finished(
      kind: string,
      column: string,
      id: string,
      at: string,
    ) {
      await database.exec(
        `INSERT INTO agent_task (id, organization_id, kind, reason, due_at, finished_at, ${column}, subject)
         VALUES ('${kind}-${id}', 'org_a', '${kind}', 'test', '${at}', '${at}', '${id}', 'old')`,
      );
    }

    it("queues the brand and profile companies are missing, and the workspace's own profile", async () => {
      await database.exec(
        `UPDATE workspace SET website = 'a.test' WHERE organization_id = 'org_a';
         INSERT INTO company (id, organization_id, name, domain, enrichment_status, icon_url, archived_at) VALUES
           ('never', 'org_a', 'Never', 'never.test', 'PENDING', NULL, NULL),
           ('failed', 'org_a', 'Failed', 'failed.test', 'FAILED', '/icon', NULL),
           ('failed_long_ago', 'org_a', 'Failed long ago', 'old.test', 'FAILED', '/icon', NULL),
           ('bare', 'org_a', 'Bare', 'bare.test', 'COMPLETE', NULL, NULL),
           ('checked', 'org_a', 'Checked', 'checked.test', 'COMPLETE', NULL, NULL),
           ('archived', 'org_a', 'Archived', 'archived.test', 'PENDING', NULL, '${ago(HOUR)}'),
           ('no_domain', 'org_a', 'No domain', NULL, 'PENDING', NULL, NULL);`,
      );
      await finished("brand", "company_id", "failed", ago(HOUR));
      await finished("brand", "company_id", "failed_long_ago", ago(2 * DAY));
      await finished("brand", "company_id", "checked", ago(10 * DAY));

      expect(await runEnrichmentSweep({ contextReady: ready })).toBe(2);
      expect(await queued()).toEqual([
        "brand company:bare",
        "brand company:failed_long_ago",
        "brand company:never",
        "company-profile company:failed_long_ago",
        "company-profile company:never",
        "workspace-profile workspace",
      ]);
    });

    it("queues a photo where there is somewhere to look, and research for contacts never researched", async () => {
      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain, enrichment_status, icon_url) VALUES ('employer', 'org_a', 'Employer', 'employer.test', 'COMPLETE', '/icon');
         INSERT INTO contact (id, organization_id, first_name, enrichment_status, github_url, linkedin_url, company_id, image_url) VALUES
           ('github', 'org_a', 'Gil', 'COMPLETE', 'https://github.com/gil', NULL, NULL, NULL),
           ('linkedin', 'org_a', 'Lin', 'COMPLETE', NULL, 'https://www.linkedin.com/in/lin', NULL, NULL),
           ('employee', 'org_a', 'Emma', 'COMPLETE', NULL, NULL, 'employer', NULL),
           ('pictured', 'org_a', 'Pia', 'COMPLETE', 'https://github.com/pia', NULL, NULL, '/photo'),
           ('looked', 'org_a', 'Lou', 'COMPLETE', 'https://github.com/lou', NULL, NULL, NULL),
           ('fresh', 'org_a', 'Fred', 'PENDING', NULL, NULL, NULL, NULL),
           ('failed', 'org_a', 'Fay', 'FAILED', NULL, NULL, NULL, NULL);`,
      );
      await finished("portrait", "contact_id", "looked", ago(10 * DAY));
      await finished("identify", "contact_id", "failed", ago(HOUR));

      await runEnrichmentSweep({ contextReady: ready });
      expect(await queued()).toEqual([
        "identify contact:fresh",
        "portrait contact:employee",
        "portrait contact:github",
        "portrait contact:linkedin",
      ]);
    });

    it("leaves what needs Context.dev until the gateway has its key, then queues it", async () => {
      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain, enrichment_status, icon_url) VALUES ('acme', 'org_a', 'Acme', 'acme.test', 'PENDING', '/favicon');
         INSERT INTO contact (id, organization_id, first_name, enrichment_status, linkedin_url) VALUES ('ana', 'org_a', 'Ana', 'COMPLETE', 'https://www.linkedin.com/in/ana');`,
      );
      await finished("brand", "company_id", "acme", ago(HOUR));
      await runEnrichmentSweep({ contextReady: noKey });
      expect(await queued()).toEqual([]);

      await database.exec(`UPDATE workspace SET enrichment_swept_at = NULL`);
      await runEnrichmentSweep({ contextReady: ready });
      expect(await queued()).toEqual([
        "brand company:acme",
        "company-profile company:acme",
        "portrait contact:ana",
      ]);
    });

    it("queues nothing for an organization out of credits, and only its own records for the next", async () => {
      await database.exec(
        `UPDATE workspace SET website = 'a.test' WHERE organization_id = 'org_a';
         INSERT INTO company (id, organization_id, name, domain) VALUES ('acme', 'org_a', 'Acme', 'acme.test');
         INSERT INTO contact (id, organization_id, first_name, github_url, company_id) VALUES
           ('ana', 'org_a', 'Ana', 'https://github.com/ana', 'acme'), ('bo', 'org_b', 'Bo', NULL, NULL);`,
      );
      await runEnrichmentSweep({
        contextReady: ready,
        credits: async (organizationId) => organizationId !== "org_a",
      });
      expect(await queued("org_a")).toEqual([]);
      expect(await queued("org_b")).toEqual(["identify contact:bo"]);
    });

    it("sweeps each organization at most every five minutes", async () => {
      expect(await runEnrichmentSweep({ contextReady: ready })).toBe(2);
      expect(await runEnrichmentSweep({ contextReady: ready })).toBe(0);
      await database.exec(
        `UPDATE workspace SET enrichment_swept_at = '${ago(6 * 60_000)}' WHERE organization_id = 'org_b'`,
      );
      expect(await runEnrichmentSweep({ contextReady: ready })).toBe(1);
    });
  });
}
