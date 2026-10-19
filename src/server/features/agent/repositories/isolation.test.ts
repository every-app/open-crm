import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// What one organization holds never shows up in another's reads, and another
// organization's writes never land on it: one test per agent repository.
// Every record below is org_a's; each test reads it as org_a (so an empty
// answer is not mistaken for isolation), then as org_b.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { AgentAccountRepository } from "./AgentAccountRepository";
import { AgentConversationRepository } from "./AgentConversationRepository";
import { AgentDealRepository } from "./AgentDealRepository";
import { AgentEnrichmentRepository } from "./AgentEnrichmentRepository";
import { AgentEventRepository } from "./AgentEventRepository";
import { AgentFactRepository } from "./AgentFactRepository";
import { AgentHistoryRepository } from "./AgentHistoryRepository";
import { AgentLookupRepository } from "./AgentLookupRepository";
import { AgentPeopleRepository } from "./AgentPeopleRepository";
import { AgentProfileRepository } from "./AgentProfileRepository";
import { AgentRecordRepository } from "./AgentRecordRepository";
import { AgentSweepRepository } from "./AgentSweepRepository";
import { ResearchHoldRepository } from "./ResearchHoldRepository";

const OWN = "org_a";
const OTHER = "org_b";
const SESSION = "chat.6f72675f61.11111111-1111-1111-1111-111111111111";

const rowsSchema = z.array(z.record(z.string(), z.unknown()));
const rows = async (sql: string) => rowsSchema.parse(await database.rows(sql));

beforeEach(async () => {
  await database.exec(
    `DELETE FROM agent_event; DELETE FROM agent_conversation; DELETE FROM activity; DELETE FROM contact_brief; DELETE FROM contact_fact;
     DELETE FROM deal_contact; DELETE FROM deal; DELETE FROM contact; DELETE FROM company;
     DELETE FROM workspace_profile; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
  );
  await database.seedTwoOrganizations();
  await database.exec(
    `INSERT INTO workspace (organization_id, name, website) VALUES ('org_a', 'Acme', 'acme.test');
     INSERT INTO workspace_profile (organization_id, website, narrative, sections) VALUES ('org_a', 'acme.test', 'Acme sells anvils.', '{}');
     INSERT INTO company (id, organization_id, name, domain) VALUES ('co_a', 'org_a', 'Fernhill', 'fernhill.test');
     INSERT INTO contact (id, organization_id, first_name, last_name, email, company_id) VALUES ('c_a', 'org_a', 'Paula', 'Marchetti', 'pm@fernhill.test', 'co_a');
     INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d_a', 'org_a', 'Fernhill renewal', 'co_a', 'user_a');
     INSERT INTO agent_conversation (id, organization_id, contact_id, user_id, session_id) VALUES ('conv_a', 'org_a', 'c_a', 'user_a', '${SESSION}');
     INSERT INTO agent_event (id, organization_id, session_id, contact_id, type, data, emitted_at) VALUES ('e_a', 'org_a', 'task.x', 'c_a', 'step.completed', '{}', '2026-10-16T00:00:00.000Z');
     INSERT INTO contact_fact (id, organization_id, contact_id, field, value, score, band, evidence, method, status) VALUES
       ('fact_a', 'org_a', 'c_a', 'title', 'Head of Revenue', 0.6, 'PROBABLE', '[]', 'web', 'PROPOSED'),
       ('fact_e', 'org_a', 'c_a', 'employer', 'Fernhill', 0.85, 'VERIFIED', '[]', 'linkedin.profile', 'APPLIED');`,
  );
});

describe("organization isolation", () => {
  it("AgentRecordRepository", async () => {
    expect(
      await AgentRecordRepository.contactForPreamble(OWN, "c_a"),
    ).not.toBeNull();
    expect(
      await AgentRecordRepository.recordExists(OTHER, {
        kind: "contact",
        id: "c_a",
      }),
    ).toBe(false);
    expect(
      await AgentRecordRepository.contactForPreamble(OTHER, "c_a"),
    ).toBeNull();
    expect(
      await AgentRecordRepository.companyForPreamble(OTHER, "co_a"),
    ).toBeNull();
    expect(
      await AgentRecordRepository.dealForPreamble(OTHER, "d_a"),
    ).toBeNull();
    await AgentRecordRepository.setEnrichmentStatus(
      OTHER,
      { contactId: "c_a", companyId: "co_a" },
      "FAILED",
      "not yours",
      "unlessComplete",
    );
    expect(await rows("SELECT enrichment_status FROM contact")).toEqual([
      { enrichment_status: "PENDING" },
    ]);
  });

  it("AgentEnrichmentRepository", async () => {
    expect(
      await AgentEnrichmentRepository.companyForBrand(OWN, "co_a"),
    ).not.toBeNull();
    expect(
      await AgentEnrichmentRepository.companyForBrand(OTHER, "co_a"),
    ).toBeNull();
    expect(
      await AgentEnrichmentRepository.contactForPortrait(OTHER, "c_a"),
    ).toBeNull();
    await AgentEnrichmentRepository.fillCompanyBrand(
      OTHER,
      "co_a",
      { industry: "Mining" },
      {},
    );
    expect(
      await AgentEnrichmentRepository.setContactImage(
        OTHER,
        "c_a",
        "/api/images/x",
        true,
      ),
    ).toBe(false);
    const noPictures = {
      logoUrl: null,
      logoDarkUrl: null,
      iconUrl: null,
      iconDarkUrl: null,
    };
    expect(
      await AgentEnrichmentRepository.replaceCompanyImages(
        OTHER,
        "co_a",
        noPictures,
        { logoUrl: "/api/images/x" },
      ),
    ).toBe(false);
    expect(
      await rows("SELECT industry, enrichment_status, logo_url FROM company"),
    ).toEqual([
      { industry: null, enrichment_status: "PENDING", logo_url: null },
    ]);
  });

  it("AgentProfileRepository", async () => {
    expect(await AgentProfileRepository.workspaceIdentity(OWN)).toMatchObject({
      name: "Acme",
      profile: { narrative: "Acme sells anvils." },
    });
    expect(await AgentProfileRepository.workspaceIdentity(OTHER)).toBeNull();
    expect(
      await AgentProfileRepository.writeContactBrief(OTHER, {
        contactId: "c_a",
        narrative: "Not yours.",
        sections: {},
        score: 0.9,
        sourceUrl: null,
        sessionId: "task.x",
      }),
    ).toBe(false);
    expect(
      await AgentProfileRepository.addCompanyBrief(OTHER, {
        companyId: "co_a",
        subject: "Not yours",
        body: "Not yours.",
        meta: {},
      }),
    ).toBeNull();
    expect(await rows("SELECT * FROM contact_brief")).toEqual([]);
    expect(await rows("SELECT * FROM activity")).toEqual([]);
  });

  it("AgentHistoryRepository, AgentAccountRepository and AgentDealRepository", async () => {
    expect(
      await AgentHistoryRepository.contactHistory(OWN, "c_a", {
        threads: 5,
        email: true,
        calendar: true,
      }),
    ).toMatchObject({ contact: { fullName: "Paula Marchetti" } });
    expect(
      await AgentAccountRepository.companyHistory(OWN, "co_a", {
        threads: 5,
        people: 25,
        email: true,
        calendar: true,
      }),
    ).toMatchObject({ people: [expect.objectContaining({ id: "c_a" })] });
    expect(
      await AgentHistoryRepository.contactHistory(OTHER, "c_a", {
        threads: 5,
        email: true,
        calendar: true,
      }),
    ).toBeNull();
    expect(
      await AgentAccountRepository.companyHistory(OTHER, "co_a", {
        threads: 5,
        people: 25,
        email: true,
        calendar: true,
      }),
    ).toBeNull();
    expect(
      await AgentDealRepository.dealHistory(OTHER, "d_a", {
        threads: 5,
        email: true,
        calendar: true,
      }),
    ).toBeNull();
  });

  it("AgentLookupRepository", async () => {
    const search = { term: "fernhill", words: ["fernhill"], take: 10 };
    expect(
      await AgentLookupRepository.searchContacts(OWN, {
        ...search,
        email: null,
      }),
    ).toEqual([expect.objectContaining({ id: "c_a" })]);
    expect(
      await AgentLookupRepository.searchContacts(OTHER, {
        ...search,
        email: null,
      }),
    ).toEqual([]);
    expect(
      await AgentLookupRepository.searchCompanies(OTHER, {
        ...search,
        domain: "fernhill.test",
      }),
    ).toEqual([]);
    expect(await AgentLookupRepository.searchDeals(OTHER, search)).toEqual([]);
    expect(
      await AgentLookupRepository.listDeals(
        OTHER,
        { status: "all", limit: 10, offset: 0 },
        new Date(),
      ),
    ).toEqual([]);
    expect(await AgentLookupRepository.contactsNeedingWork(OTHER, 10)).toEqual(
      [],
    );
  });

  it("AgentConversationRepository", async () => {
    expect(
      await AgentConversationRepository.findBySession(OWN, SESSION),
    ).toMatchObject({
      id: "conv_a",
    });
    expect(
      await AgentConversationRepository.findBySession(OTHER, SESSION),
    ).toBeNull();
    expect(
      await AgentConversationRepository.listForRecord(
        OTHER,
        "user_a",
        "contactId",
        "c_a",
      ),
    ).toEqual([]);
    expect(
      await AgentConversationRepository.markRead(OTHER, "user_a", "conv_a"),
    ).toBe(false);
    expect(
      await AgentConversationRepository.setTitleIfEmpty(
        OTHER,
        "conv_a",
        "Not yours",
      ),
    ).toBeNull();
  });

  it("AgentFactRepository", async () => {
    expect(await AgentFactRepository.find(OWN, "fact_a")).not.toBeNull();
    expect(await AgentFactRepository.contactFor(OTHER, "c_a")).toBeNull();
    expect(await AgentFactRepository.factsFor(OTHER, "c_a", "title")).toEqual(
      [],
    );
    expect(await AgentFactRepository.find(OTHER, "fact_a")).toBeNull();
    expect(await AgentFactRepository.proposals(OTHER, 10)).toEqual([]);
    expect(await AgentFactRepository.appliedValues(OTHER, ["c_a"])).toEqual(
      new Map(),
    );
    expect(await AgentFactRepository.employers(OTHER, "c_a")).toEqual({
      previous: null,
      current: null,
    });
    const fact = {
      contactId: "c_a",
      field: "title",
      value: "Mole",
      score: 0.9,
      band: "VERIFIED" as const,
      evidence: [],
      method: "web",
      sourceUrl: null,
      sessionId: null,
    };
    expect(
      await AgentFactRepository.record(OTHER, {
        fact,
        applied: true,
        write: { patch: { title: "Mole" }, expected: null },
      }),
    ).toBe(false);
    expect(
      await AgentFactRepository.decide(OTHER, {
        fact: { id: "fact_a", contactId: "c_a", field: "title" },
        accept: true,
        decidedById: "user_b",
        write: { patch: { title: "Mole" }, expected: null },
      }),
    ).toBe(false);
    expect(
      await AgentFactRepository.fill(OTHER, {
        factId: "fact_a",
        contactId: "c_a",
        field: "title",
        write: { patch: { title: "Mole" }, expected: { title: null } },
      }),
    ).toBe(false);
    await AgentFactRepository.supersede(OTHER, ["fact_a"]);
    expect(
      await rows("SELECT id, status FROM contact_fact ORDER BY id"),
    ).toEqual([
      { id: "fact_a", status: "PROPOSED" },
      { id: "fact_e", status: "APPLIED" },
    ]);
    expect(await rows("SELECT title FROM contact")).toEqual([{ title: null }]);
  });

  it("AgentPeopleRepository", async () => {
    expect(await AgentPeopleRepository.subject(OWN, "c_a")).toMatchObject({
      companyName: "Fernhill",
    });
    expect(await AgentPeopleRepository.subject(OTHER, "c_a")).toBeNull();
    expect(await AgentPeopleRepository.companyExists(OTHER, "co_a")).toBe(
      false,
    );
    await AgentPeopleRepository.stampSocialsChecked(OTHER, "c_a");
    expect(
      await AgentPeopleRepository.raiseJobChange(OTHER, {
        contactId: "c_a",
        companyId: "co_a",
        subject: "Not yours",
        body: "Not yours.",
        meta: {},
        moveToCompanyId: "co_a",
      }),
    ).toBe(false);
    expect(await rows("SELECT socials_checked_at FROM contact")).toEqual([
      { socials_checked_at: null },
    ]);
    expect(await rows("SELECT * FROM activity")).toEqual([]);
  });

  it("AgentEventRepository", async () => {
    expect(
      await AgentEventRepository.listForRecord(
        OWN,
        "user_a",
        "contactId",
        "c_a",
        50,
      ),
    ).toEqual([expect.objectContaining({ id: "e_a" })]);
    expect(
      await AgentEventRepository.listForRecord(
        OTHER,
        "user_b",
        "contactId",
        "c_a",
        50,
      ),
    ).toEqual([]);
    expect(await AgentEventRepository.listForSession(OTHER, "task.x")).toEqual(
      [],
    );
  });
});

describe("organization isolation of the sweep's reads", () => {
  it("AgentSweepRepository", async () => {
    await database.exec(
      `UPDATE company SET logo_url = 'https://cdn.test/logo.png' WHERE id = 'co_a'`,
    );
    const since = new Date().toISOString();
    expect(
      await AgentSweepRepository.companiesWithoutIcon(OWN, since, 25),
    ).toEqual(["co_a"]);
    expect(
      await AgentSweepRepository.companiesWithoutIcon(OTHER, since, 25),
    ).toEqual([]);
    expect(
      await AgentSweepRepository.companiesWithUncopiedImages(OWN, since, 25),
    ).toHaveLength(1);
    expect(
      await AgentSweepRepository.companiesWithUncopiedImages(OTHER, since, 25),
    ).toEqual([]);
    await AgentSweepRepository.noteDone(OWN, "favicon", [
      { companyId: "co_a", outcome: "ours" },
    ]);
    await AgentSweepRepository.noteDone(OTHER, "favicon", [
      { companyId: "co_a", outcome: "theirs" },
    ]);
    expect(
      await rows(
        "SELECT outcome FROM agent_task WHERE organization_id = 'org_a'",
      ),
    ).toEqual([{ outcome: "ours" }]);
  });

  it("ResearchHoldRepository", async () => {
    const held = (organizationId: string) =>
      ResearchHoldRepository.isHeld(organizationId, "contact", "c_a");
    await ResearchHoldRepository.hold(OTHER, "contact", ["c_a"]);
    expect(await held(OWN)).toBe(false);
    await ResearchHoldRepository.hold(OWN, "contact", ["c_a"]);
    expect(await held(OTHER)).toBe(false);
    await ResearchHoldRepository.release(OTHER, "contact", "c_a");
    expect(await held(OWN)).toBe(true);
  });
});
