import { beforeAll, describe, expect, it, vi } from "vitest";

// The record tools end to end below the gateway: a minted identity in, the
// SDK's checks, the feature's service, real SQL, the output schema's fields
// out.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));
vi.mock("@/server/features/team-agents/runtime/poke", () => ({
  pokeEvents: vi.fn(),
  pokeRuns: vi.fn(),
}));

import {
  ana,
  bo,
  call,
  failure,
  idFrom,
} from "@/server/everyapp/toolTestSupport";

beforeAll(() => testDb.seedTwoOrganizations());

describe("record tools", () => {
  it("companies: create, change, find (owners by email or id), read with its people, archive; another organization can't reach one", async () => {
    const id = await idFrom("create_company", {
      name: "Acme",
      domain: "https://www.acme.com/pricing",
      ownerEmail: ana.email,
    });
    await call("update_company", { id, industry: "Software" });
    // Owners by email or by the id list_members and saved views give.
    for (const owner of [ana.email, ana.sub]) {
      expect(
        await call("list_companies", { query: "acm", owners: [owner] }),
      ).toMatchObject({
        total: 1,
        companies: [
          {
            id,
            domain: "acme.com",
            industry: "Software",
            owner: { email: ana.email },
            queued: true,
          },
        ],
      });
    }
    // A work email files the contact under the company with its domain.
    const jo = await idFrom("create_contact", {
      firstName: "Jo",
      email: "jo@acme.com",
      phone: "+1 555 0100",
    });
    await call("set_primary_contact", { companyId: id, contactId: jo });
    expect(await call("get_company", { id })).toMatchObject({
      owner: { name: "Ana", email: ana.email },
      primaryContact: { id: jo, name: "Jo", phone: "+1 555 0100" },
      contacts: [{ id: jo, name: "Jo" }],
    });
    expect(await call("get_contact", { id: jo })).toMatchObject({
      company: { id, industry: "Software" },
    });

    expect(await failure("get_company", { id }, { as: bo })).toBe(
      `No company with id ${id}.`,
    );
    await call("archive_company", { id });
    expect(await call("list_companies", { query: "acm" })).toMatchObject({
      total: 0,
    });
  });

  it("lists: by how records came in, a page size, and a company's pricing and careers pages", async () => {
    const soylent = await idFrom("create_company", {
      name: "Soylent",
      domain: "soylent.test",
    });
    await idFrom("create_company", { name: "Soylent Labs" });
    const jo = await idFrom("create_contact", {
      firstName: "Jo",
      email: "jo@soylent.test",
    });
    await testDb.exec(`
      UPDATE company SET source = 'TRACKING', pricing_url = 'https://soylent.test/pricing', careers_url = 'https://soylent.test/jobs' WHERE id = '${soylent}';
      UPDATE contact SET source = 'EMAIL' WHERE id = '${jo}';
    `);
    expect(
      await call(
        "list_companies",
        { query: "soylent", sources: ["TRACKING"] },
        { scopes: ["mcp:read"] },
      ),
    ).toMatchObject({
      total: 1,
      companies: [{ id: soylent, source: "TRACKING" }],
    });
    expect(
      await call("list_companies", {
        query: "soylent",
        sort: "name",
        page: 2,
        pageSize: 1,
      }),
    ).toMatchObject({
      total: 2,
      pageSize: 1,
      companies: [{ name: "Soylent Labs" }],
    });
    expect(
      await call("list_contacts", { query: "soylent", sources: ["EMAIL"] }),
    ).toMatchObject({ total: 1, contacts: [{ id: jo, source: "EMAIL" }] });
    expect(await call("get_company", { id: soylent })).toMatchObject({
      pricingUrl: "https://soylent.test/pricing",
      careersUrl: "https://soylent.test/jobs",
    });
    // A blank filter value is refused by name, as the list's own rules say.
    expect(await failure("list_companies", { industries: [" "] })).toContain(
      "industries.0",
    );
    expect(await failure("list_contacts", { titles: [""] })).toContain(
      "titles.0",
    );
  });

  it("contact suggestions: lists the organization's waiting ones, and accepting one writes it on the contact", async () => {
    const id = await idFrom("create_contact", {
      firstName: "Mia",
      email: "mia@globex.test",
      title: "Engineer",
    });
    await testDb.exec(
      `INSERT INTO contact_fact (id, organization_id, contact_id, field, value, score, band, evidence, method) VALUES ('fact_1', 'org_a', '${id}', 'title', 'VP Engineering', 0.6, 'PROBABLE', '[{"kind":"web","detail":"Their profile says so"}]', 'web')`,
    );
    expect(await call("list_contact_suggestions")).toMatchObject({
      total: 1,
      suggestions: [
        {
          id: "fact_1",
          field: "title",
          value: "VP Engineering",
          why: ["Their profile says so"],
          contact: { id, name: "Mia" },
        },
      ],
    });
    expect(await call("list_contact_suggestions", {}, { as: bo })).toEqual({
      total: 0,
      page: 1,
      pageSize: 25,
      suggestions: [],
    });
    expect(
      await failure(
        "decide_contact_suggestion",
        { id: "fact_1", decision: "accept" },
        { as: bo },
      ),
    ).toBe("No suggestion with id fact_1.");

    expect(
      await call("decide_contact_suggestion", {
        id: "fact_1",
        decision: "accept",
      }),
    ).toEqual({ contactId: id, field: "title", applied: true });
    expect(await call("get_contact", { id })).toMatchObject({
      title: "VP Engineering",
      suggestions: [],
    });
  });

  it("deals: added to a company, moved through stages, with people on them", async () => {
    const companyId = await idFrom("create_company", { name: "Initech" });
    const bill = await idFrom("create_contact", {
      firstName: "Bill",
      companyId,
    });
    const id = await idFrom("create_deal", {
      name: "Initech renewal",
      companyId,
      amount: 1200,
      currency: "USD",
    });
    expect(
      await failure("set_deal_stage", { id, stage: "CLOSED_LOST" }),
    ).toContain("Say why it was lost");
    await call("set_deal_stage", { id, stage: "CONTRACT_SENT" });
    await call("add_deal_contact", {
      dealId: id,
      contactId: bill,
      role: "Champion",
    });
    expect(await call("get_deal", { id })).toMatchObject({
      stage: "CONTRACT_SENT",
      owner: { email: ana.email },
      inReportingCurrency: { amount: 1200, currency: "USD" },
      contacts: [{ id: bill, name: "Bill", role: "Champion" }],
    });
    await call("set_deal_contact_role", {
      dealId: id,
      contactId: bill,
      role: null,
    });
    expect(await call("get_deal", { id })).toMatchObject({
      contacts: [{ id: bill, role: null }],
    });
  });

  it("full reads: a company's people and deals with their owners and converted amounts; a contact's applied facts apart from their suggestions, and their deals' owners", async () => {
    const companyId = await idFrom("create_company", { name: "Initrode" });
    const jo = await idFrom("create_contact", {
      firstName: "Jo",
      companyId,
      ownerEmail: ana.email,
    });
    const dealId = await idFrom("create_deal", {
      name: "Initrode pilot",
      companyId,
      amount: 500,
      currency: "USD",
    });
    await call("add_deal_contact", { dealId, contactId: jo });
    await testDb.exec(
      `INSERT INTO contact_fact (id, organization_id, contact_id, field, value, score, band, evidence, method, status) VALUES ('fact_cto', 'org_a', '${jo}', 'title', 'CTO', 0.9, 'VERIFIED', '[]', 'web', 'APPLIED'), ('fact_ceo', 'org_a', '${jo}', 'title', 'CEO', 0.6, 'PROBABLE', '[]', 'web', 'PROPOSED')`,
    );
    const owner = { name: "Ana", email: ana.email };
    expect(await call("get_company", { id: companyId })).toMatchObject({
      contacts: [{ id: jo, owner }],
      deals: [
        {
          id: dealId,
          owner,
          inReportingCurrency: { amount: 500, currency: "USD" },
        },
      ],
    });
    expect(await call("get_contact", { id: jo })).toMatchObject({
      facts: [{ field: "title", value: "CTO", band: "VERIFIED" }],
      suggestions: [{ id: "fact_ceo" }],
      deals: [{ id: dealId, owner }],
    });
  });

  it("bulk actions say how many records they changed and why the first one failed", async () => {
    const id = await idFrom("create_company", { name: "Umbrella" });
    expect(
      await call("bulk_archive", { kind: "company", ids: [id, "nope"] }),
    ).toEqual({
      requested: 2,
      succeeded: 1,
      failed: 1,
      error: "NOT_FOUND",
      message: null,
    });
    expect(
      await call("bulk_restore", { kind: "company", ids: [id] }),
    ).toMatchObject({ succeeded: 1, error: null });
  });

  it("search_records turns a name into ids", async () => {
    const id = await idFrom("create_company", {
      name: "Wayne Enterprises",
      domain: "wayne.test",
    });
    expect(await call("search_records", { query: "wayne" })).toEqual({
      results: [
        {
          kind: "company",
          id,
          name: "Wayne Enterprises",
          detail: "wayne.test",
        },
      ],
    });
  });
});

describe("saved view tools", () => {
  it("saved views: a list's filters saved under a name, the owner by email, changed only on the caller's own view of that list", async () => {
    const view = await call("create_saved_view", {
      entity: "COMPANY",
      name: "Mine",
      filters: { owners: [ana.email], query: "acme" },
    });
    expect(view).toMatchObject({
      name: "Mine",
      mine: true,
      filters: { owner: ["user_a"], q: "acme" },
    });
    expect(await call("list_saved_views", { entity: "COMPANY" })).toMatchObject(
      { views: [{ id: view.id, name: "Mine" }] },
    );
    expect(
      await call("list_saved_views", { entity: "COMPANY" }, { as: bo }),
    ).toEqual({ views: [] });

    // Only onto the caller's own view, of the list it filters.
    expect(
      await failure("update_saved_view", {
        id: view.id,
        entity: "DEAL",
        filters: { stages: ["DEMO_BOOKED"] },
      }),
    ).toBe("That view is of companies, not deals.");
    expect(
      await failure(
        "update_saved_view",
        { id: view.id, entity: "COMPANY", name: "Theirs" },
        { as: bo },
      ),
    ).toBe("You have no such saved view.");
    expect(
      await call("update_saved_view", {
        id: view.id,
        entity: "COMPANY",
        name: "Acme, mine",
      }),
    ).toMatchObject({ name: "Acme, mine", filters: { owner: ["user_a"] } });

    // The companies' and contacts' own filters, as their lists' URLs keep them.
    expect(
      await call("create_saved_view", {
        entity: "COMPANY",
        name: "Software",
        filters: {
          industries: ["Software"],
          enrichment: ["COMPLETE"],
          activeWithinDays: 30,
        },
      }),
    ).toMatchObject({
      filters: {
        industry: ["Software"],
        enrichment: ["COMPLETE"],
        activity: 30,
      },
    });
    expect(
      await call("create_saved_view", {
        entity: "CONTACT",
        name: "Founders",
        filters: {
          companyIds: ["none"],
          titles: ["CEO"],
          seniorities: ["Founder"],
          personas: ["Executive"],
        },
      }),
    ).toMatchObject({
      filters: {
        company: ["none"],
        title: ["CEO"],
        seniority: ["Founder"],
        persona: ["Executive"],
      },
    });
    expect(
      await failure("create_saved_view", {
        entity: "COMPANY",
        name: "Demos",
        filters: { stages: ["DEMO_BOOKED"] },
      }),
    ).toBe("stages doesn't filter companies.");
  });
});
