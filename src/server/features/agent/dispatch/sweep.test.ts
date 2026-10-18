import { sortBy } from "remeda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The enrichment sweep's selection is new SQL (correlated NOT EXISTS, a left
// join, the claim's conditional update): both backends must pick the same
// records.
const { databases, current, r2 } = await vi.hoisted(async () => {
  const { createPgTestDb, createSqliteTestDb } =
    await import("@/server/testing/testDb");
  return {
    databases: {
      sqlite: await createSqliteTestDb(),
      postgres: await createPgTestDb(),
    },
    current: { dialect: "sqlite" as "sqlite" | "postgres" },
    r2: { put: vi.fn<(key: string, value: unknown) => Promise<void>>() },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return current.dialect === "postgres" ? "postgres" : "d1";
    },
    R2: r2,
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

import { pokeDispatcher } from "@/server/features/agent/poke";
import { runEnrichmentSweep } from "./sweep";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const taskRows = z.array(z.object({ kind: z.string(), subject: z.string() }));
const ready = async () => true;
const noKey = async () => false;

/** Only *.icon.test sites (their /favicon.ico) and cdn.test serve images. */
const sites = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const image =
    url.hostname === "cdn.test" ||
    (url.hostname.endsWith(".icon.test") && url.pathname === "/favicon.ico");
  if (!image) return new Response(null, { status: 404 });
  return new Response(
    init?.method === "HEAD" ? null : new Uint8Array([0, 0, 1, 0]),
    { headers: { "content-type": "image/x-icon" } },
  );
});

/** The path of the organization's copy of `name` (an icon) in R2. */
const copyOf = (name: string): unknown =>
  expect.stringMatching(
    new RegExp(`^/api/images/org_a/companies/${name}-\\w+\\.ico$`),
  );

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`the enrichment sweep (${dialect})`, () => {
    const database = databases[dialect];

    beforeEach(async () => {
      current.dialect = dialect;
      vi.stubGlobal("fetch", sites);
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
      const rows = taskRows.parse(
        await database.rows(
          `SELECT kind, subject FROM agent_task WHERE organization_id = '${organizationId}' AND finished_at IS NULL`,
        ),
      );
      return sortBy(
        rows.map((row) => `${row.kind} ${row.subject}`),
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
      // The minute cron's own lanes take the work: no lane started per
      // organization swept.
      expect(pokeDispatcher).not.toHaveBeenCalled();
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

    it("fetches the favicon of each company with a domain and no icon, out of credits or with research held, and tries it once a day", async () => {
      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain, icon_url) VALUES
           ('found', 'org_a', 'Found', 'found.icon.test', NULL),
           ('tried', 'org_a', 'Tried', 'tried.icon.test', NULL),
           ('iconed', 'org_a', 'Iconed', 'iconed.icon.test', '/api/images/org_a/i.png');`,
      );
      await finished("favicon", "company_id", "tried", ago(HOUR));
      const icons = async () =>
        database.rows(`SELECT id, icon_url FROM company ORDER BY id`);

      await runEnrichmentSweep({
        contextReady: ready,
        credits: async () => false,
      });
      expect(await icons()).toEqual([
        { id: "found", icon_url: copyOf("found/icon") },
        { id: "iconed", icon_url: "/api/images/org_a/i.png" },
        { id: "tried", icon_url: null },
      ]);

      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain) VALUES ('held', 'org_a', 'Held', 'held.icon.test');
         UPDATE workspace SET enrichment_swept_at = NULL;`,
      );
      await runEnrichmentSweep({ contextReady: ready, askedForOnly: true });
      expect(
        await database.rows(`SELECT icon_url FROM company WHERE id = 'held'`),
      ).toEqual([{ icon_url: copyOf("held/icon") }]);
      expect(await queued()).toEqual([]);
    });

    it("copies the logos and icons still at their source URL, and leaves our copies", async () => {
      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain, logo_url, icon_url) VALUES
           ('linked', 'org_a', 'Linked', NULL, 'https://cdn.test/logo.png', '/api/images/org_a/companies/linked/icon-1.png');`,
      );
      await runEnrichmentSweep({ contextReady: ready });
      expect(
        await database.rows(`SELECT logo_url, icon_url FROM company`),
      ).toEqual([
        {
          logo_url: copyOf("linked/logoUrl"),
          icon_url: "/api/images/org_a/companies/linked/icon-1.png",
        },
      ]);
      expect(r2.put).toHaveBeenCalledTimes(1);
    });
  });
}
