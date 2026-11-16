import { beforeEach, describe, expect, it, vi } from "vitest";

// Enrichment against a real database, with the providers' HTTP answers
// stubbed: what a run writes, what it leaves alone, and whose records it
// may touch.
const { database, answers, storeImage } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    /** The JSON each provider answers with, by request URL. */
    answers: new Map<string, unknown>(),
    storeImage: vi.fn<(...args: string[]) => Promise<string | null>>(),
  };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);
vi.mock("@/server/lib/images", () => ({ storeImage }));
vi.mock("../providers/gateway", () => ({
  providerStatus: (provider: string) =>
    Promise.resolve({ provider, ready: true, setup: null, command: null }),
  providerFetch: () =>
    Promise.resolve((url: string) =>
      Promise.resolve(Response.json(answers.get(url) ?? null)),
    ),
}));

import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { EnrichmentService } from "./EnrichmentService";

const A = { organizationId: "org_a", userId: "user_a" };
const B = { organizationId: "org_b", userId: "user_b" };
const TREG_PERSON = "https://treg.to/call/treg.people.enrich";
const CONTEXT_PERSON = "https://api.context.dev/v1/people/enrich";
const CONTEXT_BRAND = "https://api.context.dev/v1/brand/retrieve";

const contactRow = async (id: string) =>
  (
    await database.rows(
      `SELECT title, linkedin_url, image_url FROM contact WHERE id = '${id}'`,
    )
  )[0];

describe("EnrichmentService", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    answers.clear();
    storeImage.mockResolvedValue(null);
  });

  it("fills a contact's blanks, keeps what a person typed, and says so on the timeline", async () => {
    await EnrichmentService.setPreferred(A.organizationId, "contact", "treg");
    const ana = await ContactService.createContact(A.organizationId, {
      firstName: "Ana",
      email: "ana@acme.com",
      title: "Founder",
    });
    answers.set(TREG_PERSON, {
      output: {
        full_name: "Ana Zed",
        title: "Chief Executive",
        linkedin_url: "https://linkedin.com/in/ana-zed/",
      },
    });

    const run = await EnrichmentService.enrichContacts(A, [ana.id]);

    expect(run).toEqual({
      provider: "treg",
      results: [{ id: ana.id, outcome: "enriched", reason: null }],
    });
    expect(await contactRow(ana.id)).toMatchObject({
      title: "Founder",
      linkedin_url: "https://www.linkedin.com/in/ana-zed",
    });
    expect(
      await database.rows(
        `SELECT subject, body, created_by_id FROM activity WHERE type = 'ENRICHMENT' AND contact_id = '${ana.id}'`,
      ),
    ).toMatchObject([
      {
        subject: "Enriched with Treg",
        body: "Filled in LinkedIn.",
        created_by_id: "user_a",
      },
    ]);

    // Asked again, the provider has nothing the contact lacks.
    const again = await EnrichmentService.enrichContacts(A, [ana.id]);
    expect(again.results).toEqual([
      { id: ana.id, outcome: "nothing", reason: null },
    ]);
  });

  it("never looks up or writes another organization's record", async () => {
    const bo = await ContactService.createContact(B.organizationId, {
      firstName: "Bo",
      email: "bo@other.com",
    });
    answers.set(TREG_PERSON, {
      output: { full_name: "Bo", title: "Spy", linkedin_url: null },
    });

    const run = await EnrichmentService.enrichContacts(A, [bo.id]);

    expect(run.results).toEqual([
      { id: bo.id, outcome: "skipped", reason: "It no longer exists." },
    ]);
    expect(await contactRow(bo.id)).toMatchObject({ title: null });
  });

  it("reports a miss as skipped and leaves the contact alone", async () => {
    await EnrichmentService.setPreferred(A.organizationId, "contact", "treg");
    const ana = await ContactService.createContact(A.organizationId, {
      firstName: "Ana",
      email: "ana@acme.com",
    });
    // Treg answers a miss with a 200 and no name.
    answers.set(TREG_PERSON, { output: { full_name: null } });

    const run = await EnrichmentService.enrichContacts(A, [ana.id]);

    expect(run.results).toEqual([
      { id: ana.id, outcome: "skipped", reason: "Treg has no match." },
    ]);
    expect(await database.rows(`SELECT id FROM activity`)).toEqual([]);
  });

  it("stores Context.dev's photograph as the CRM's own copy, or not at all", async () => {
    await EnrichmentService.setPreferred(
      A.organizationId,
      "contact",
      "context",
    );
    const [ana, cy] = await Promise.all(
      ["ana@acme.com", "cy@acme.com"].map((email) =>
        ContactService.createContact(A.organizationId, {
          firstName: "A",
          email,
        }),
      ),
    );
    answers.set(CONTEXT_PERSON, {
      match: {
        status: "candidate",
        score: 90,
        person: {
          avatar_url: "https://media.licdn.com/photo.jpg",
          social_urls: [],
          current_role: null,
        },
      },
    });
    storeImage.mockImplementation((_org, name) =>
      Promise.resolve(
        name.includes(ana.id) ? "/api/images/org_a/photo.jpg" : null,
      ),
    );

    const run = await EnrichmentService.enrichContacts(A, [ana.id, cy.id]);

    expect(run.results.map((result) => result.outcome)).toEqual([
      "enriched",
      "nothing",
    ]);
    expect(await contactRow(ana.id)).toMatchObject({
      image_url: "/api/images/org_a/photo.jpg",
    });
    // The source URL expires, so one that couldn't be copied isn't kept.
    expect(await contactRow(cy.id)).toMatchObject({ image_url: null });
  });

  it("names a company still called by its domain, and fills its brand", async () => {
    const acme = await CompanyService.createCompany(A.organizationId, {
      name: "acme.com",
      domain: "acme.com",
    });
    await database.exec(
      `UPDATE company SET industry = 'Anvils' WHERE id = '${acme.id}'`,
    );
    answers.set(CONTEXT_BRAND, {
      brand: {
        title: "Acme",
        description: "Makes anvils.",
        industries: { eic: [{ industry: "Manufacturing" }] },
        logos: [
          {
            url: "https://media.brand.dev/logo.png",
            type: "logo",
            mode: "light",
          },
        ],
      },
    });

    const run = await EnrichmentService.enrichCompanies(A, [acme.id]);

    expect(run.provider).toBe("context");
    expect(
      await database.rows(
        `SELECT name, description, industry, logo_url FROM company WHERE id = '${acme.id}'`,
      ),
    ).toMatchObject([
      {
        name: "Acme",
        description: "Makes anvils.",
        industry: "Anvils",
        logo_url: "https://media.brand.dev/logo.png",
      },
    ]);
  });
});
