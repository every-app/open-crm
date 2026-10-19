import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Research that waits for a person, from the doors
// strangers can use: a website form's contact and company wait until a person
// opens each, and an import with research off waits for Enrich.
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
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { ImportService } from "@/server/features/imports/services/ImportService";
import { TrackingCollectorService } from "@/server/features/tracking/services/TrackingCollectorService";
import {
  batch,
  formSubmit,
  readySite,
} from "@/server/features/tracking/testing/trackingTestSupport";

const BROWSER = { origin: "https://acme.com", userAgent: "Mozilla/5.0" };
const idRow = z.object({ id: z.string() });
const taskRows = z.array(z.object({ kind: z.string(), subject: z.string() }));

describe("research that waits for a person", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
  });

  /** Open research tasks as `kind subject`, CRM events apart. */
  const research = async () =>
    taskRows
      .parse(
        await database.rows(
          "SELECT kind, subject FROM agent_task WHERE finished_at IS NULL AND kind <> 'agent-event' ORDER BY kind",
        ),
      )
      .map((row) => `${row.kind} ${row.subject}`);

  it("gives a website form's contact and company no paid research until a person opens each", async () => {
    const siteId = await readySite("org_a", "acme.com");
    await TrackingCollectorService.accept(
      batch(siteId, [
        formSubmit("acme.com", {
          first_name: "Jane",
          email: "jane@northwind.example",
        }),
      ]),
      BROWSER,
    );
    const contact = idRow.parse(
      (await database.rows("SELECT id FROM contact"))[0],
    );
    const company = idRow.parse(
      (await database.rows("SELECT id FROM company"))[0],
    );
    expect(await research()).toEqual([]);
    // Team agents still hear of the company.
    expect(
      await database.rows(
        "SELECT reason FROM agent_task WHERE kind = 'agent-event'",
      ),
    ).toEqual([{ reason: "company.created" }]);

    await ContactService.getContact("org_a", contact.id);
    await ContactService.getContact("org_a", contact.id);
    expect(await research()).toEqual([`identify contact:${contact.id}`]);

    await CompanyService.getCompany("org_a", company.id);
    expect(await research()).toEqual([
      `brand company:${company.id}`,
      `company-profile company:${company.id}`,
      `identify contact:${contact.id}`,
    ]);
  });

  it("keeps what an import with research off adds waiting for Enrich, which opening isn't", async () => {
    await ImportService.importChunk(
      { organizationId: "org_a", userId: "user_a" },
      {
        entity: "COMPANY",
        duplicates: "skip",
        research: false,
        dryRun: false,
        rows: [{ line: 2, values: { name: "Globex", domain: "globex.com" } }],
      },
    );
    const company = idRow.parse(
      (await database.rows("SELECT id FROM company"))[0],
    );

    await CompanyService.getCompany("org_a", company.id);
    expect(await research()).toEqual([]);

    await CompanyService.enrichCompany("org_a", company.id);
    expect(await research()).toEqual([
      `brand company:${company.id}`,
      `company-profile company:${company.id}`,
    ]);
    expect(await database.rows("SELECT research_held_at FROM company")).toEqual(
      [{ research_held_at: null }],
    );
  });
});
