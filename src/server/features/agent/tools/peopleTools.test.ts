import { beforeEach, describe, expect, it, vi } from "vitest";

// People research against stubbed vendors: Context.dev answers from
// `contextFetch`, Sonar from `ask`, GitHub from a spied fetch, and picture
// storage records the copy. What a lookup costs, what it may write, and what
// it refuses to.
const { database, contextFetch, ask } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    contextFetch: vi.fn<typeof fetch>(),
    ask: vi.fn(),
  };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));
vi.mock("@/db/runBatch", () => ({ runBatch: database.runBatch }));
vi.mock("@/server/lib/provider-access", () => ({
  getContextFetch: async () => contextFetch,
  hasContextAccess: vi.fn(),
}));
vi.mock("../lib/perplexity", () => ({
  webResearchAccess: vi.fn(),
  asker: () => ask,
}));
vi.mock("@/server/lib/images", () => ({
  imageStorageReady: () => true,
  storeImage: async (organizationId: string, name: string) =>
    `/api/images/${organizationId}/${name}-0.jpg`,
}));

import { hasContextAccess } from "@/server/lib/provider-access";
import { webResearchAccess } from "../lib/perplexity";
import {
  enriched,
  LINKEDIN_CLAIM,
  PAULA,
  says,
  toolSession,
} from "./toolTestSupport";

const githubAccount = (account: object) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(account));

describe("the agent's people research", () => {
  beforeEach(async () => {
    vi.mocked(hasContextAccess).mockResolvedValue(true);
    vi.mocked(webResearchAccess).mockResolvedValue(null);
    ask.mockResolvedValue({ ok: false, reason: "No answer." });
    contextFetch.mockImplementation(async () => enriched(PAULA));
    await database.exec(
      `DELETE FROM contact_fact; DELETE FROM contact; DELETE FROM company; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES ('co_a', 'org_a', 'Fernhill', 'fernhill.test');
       INSERT INTO contact (id, organization_id, first_name, last_name, email, company_id, linkedin_url) VALUES
         ('c_a', 'org_a', 'Paula', 'Marchetti', 'pmarchetti@fernhill.test', 'co_a', 'https://www.linkedin.com/in/paulamarchetti');`,
    );
  });

  it("copies a profile's photo only once its verdict says it is them, and charges each lookup", async () => {
    const chat = toolSession();
    contextFetch.mockImplementationOnce(async () =>
      enriched({
        name: { first: "Antonio", last: "Fontana" },
        social_urls: ["https://www.linkedin.com/in/afontana"],
        current_role: {
          title: "Data Engineer",
          organization: { name: "Brightwater", domain: "brightwater.test" },
        },
      }),
    );
    expect(
      await chat.call("get_linkedin_profile", LINKEDIN_CLAIM),
    ).toMatchObject({ found: true, verdict: { isSamePerson: false } });
    expect(await database.rows("SELECT image_url FROM contact")).toEqual([
      { image_url: null },
    ]);

    expect(
      await chat.call("get_linkedin_profile", LINKEDIN_CLAIM),
    ).toMatchObject({
      verdict: { emailMatches: true, isSamePerson: true },
      photo: { stored: true },
    });
    expect(await database.rows("SELECT image_url FROM contact")).toEqual([
      { image_url: "/api/images/org_a/contacts/c_a/photo-0.jpg" },
    ]);

    expect(chat.budget.spent).toBe(4);
    expect(
      await chat.call("get_contact_work_history", { contactId: "c_a" }),
    ).toMatchObject({ found: false, reason: says("budget") });
    expect(contextFetch).toHaveBeenCalledTimes(2);
  });

  it("spends nothing on a source this install does not have", async () => {
    vi.mocked(hasContextAccess).mockResolvedValue(false);
    const chat = toolSession();
    for (const [name, input] of [
      ["resolve_linkedin_profile", LINKEDIN_CLAIM],
      ["get_contact_work_history", { contactId: "c_a" }],
      ["research_person", { question: "What has Fernhill announced?" }],
      ["find_contact_socials", { contactId: "c_a" }],
    ] as const) {
      expect(await chat.call(name, input), name).toMatchObject({
        configured: false,
      });
    }
    expect(chat.budget.spent).toBe(0);
    expect(contextFetch).not.toHaveBeenCalled();
  });

  it("writes a GitHub account that names them, and rejects what it cannot corroborate", async () => {
    const chat = toolSession();
    githubAccount({
      login: "paulam",
      name: "Paula Marchetti",
      company: "@Fernhill",
      type: "User",
    });
    expect(
      await chat.call("set_contact_socials", {
        contactId: "c_a",
        githubUrl: "https://github.com/paulam",
        twitterUrl: "https://x.com/paulamarchetti",
      }),
    ).toMatchObject({
      written: true,
      outcomes: [{ field: "githubUrl", band: "VERIFIED", applied: true }],
      rejected: [says("Could not corroborate")],
    });

    githubAccount({
      login: "fernhill",
      name: "Fernhill",
      type: "Organization",
    });
    expect(
      await chat.call("set_contact_socials", {
        contactId: "c_a",
        githubUrl: "https://github.com/fernhill",
      }),
    ).toMatchObject({ written: false, rejected: [says("not a person")] });
    expect(
      await database.rows("SELECT github_url, twitter_url FROM contact"),
    ).toEqual([{ github_url: "https://github.com/paulam", twitter_url: null }]);
  });

  it("hands back social candidates unwritten, and notes the contact was searched", async () => {
    vi.mocked(webResearchAccess).mockResolvedValue(contextFetch);
    ask.mockImplementation(async (question: string) => ({
      ok: true,
      data: question.includes("GitHub")
        ? { text: "https://github.com/paulam", citations: [] }
        : { text: "I do not know.", citations: [] },
    }));
    const chat = toolSession();
    expect(
      await chat.call("find_contact_socials", { contactId: "c_a" }),
    ).toMatchObject({
      searched: true,
      candidates: { x: [], github: ["https://github.com/paulam"] },
    });
    expect(chat.budget.spent).toBe(2);
    expect(
      await database.rows(
        "SELECT github_url, socials_checked_at IS NOT NULL AS checked FROM contact",
      ),
    ).toEqual([{ github_url: null, checked: 1 }]);
  });
});
