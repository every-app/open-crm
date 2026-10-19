import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The evidence ledger's rules, at its write path (recordFact), a person's
// decision (decideFact) and the minute cron's blank-field pass, on both
// dialects: every write is a batch of conditional statements.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { sweepAllBlankFacts } from "./blankFacts";
import type { EVIDENCE_KINDS } from "./evidence";
import {
  decideFact,
  lastEmployerChange,
  recordFact,
  type FactField,
} from "./facts";

type Kind = (typeof EVIDENCE_KINDS)[number];

/** Matches a reason that says `text`. */
function says(text: string): unknown {
  return expect.stringContaining(text);
}

const saw = (...kinds: Kind[]) =>
  kinds.map((kind) => ({ kind, detail: `saw ${kind}` }));

// Supporting evidence only: PROBABLE, with no source that identifies them.
const SUPPORTING = saw("handle.name-form", "search.cites-profile");
// A primary source: VERIFIED.
const PRIMARY = saw("crm.thread-reply", "crm.signature-block");

const record = (
  field: FactField,
  value: string,
  evidence: ReturnType<typeof saw>,
  organizationId = "org_a",
) =>
  recordFact(organizationId, {
    contactId: "c_a",
    field,
    value,
    evidence,
    method: "test",
    sessionId: "task.x",
  });

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`the evidence ledger (${dialect})`, () => {
    const database = testDb.use(dialect);
    const contactRow = async (columns: string) =>
      (
        await database.rows(`SELECT ${columns} FROM contact WHERE id = 'c_a'`)
      )[0];
    const facts = (field: string) =>
      database.rows(
        `SELECT value, status FROM contact_fact WHERE field = '${field}' ORDER BY value`,
      );
    const proposalId = async (value: string) => {
      const [row] = await database.rows(
        `SELECT id FROM contact_fact WHERE value = '${value}' AND status = 'PROPOSED'`,
      );
      return z.object({ id: z.string() }).parse(row).id;
    };

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM contact_fact; DELETE FROM contact; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      // Nobody has named them yet: the first name is the address's local part.
      await database.exec(
        `INSERT INTO contact (id, organization_id, first_name, email) VALUES ('c_a', 'org_a', 'Pmarchetti', 'pmarchetti@fernhill.test');`,
      );
    });

    it("writes primary evidence through to the record", async () => {
      expect(await record("title", "Head of Security", PRIMARY)).toMatchObject({
        stored: true,
        applied: true,
        band: "VERIFIED",
      });
      expect(await contactRow("title")).toEqual({ title: "Head of Security" });
      expect(await facts("title")).toEqual([
        { value: "Head of Security", status: "APPLIED" },
      ]);
    });

    it("fills a blank from anything that clears the floor, and keeps nothing below it", async () => {
      expect(
        await record("twitterUrl", "https://x.com/pmarchetti", SUPPORTING),
      ).toMatchObject({ applied: true, band: "PROBABLE" });
      expect(await record("title", "VP", saw("employer-only"))).toMatchObject({
        stored: false,
        band: null,
      });
      expect(await contactRow("twitter_url, title")).toEqual({
        twitter_url: "https://x.com/pmarchetti",
        title: null,
      });
    });

    it("replaces the agent's value only on a primary source, settling what waited", async () => {
      await record("title", "Head of Security", SUPPORTING);
      // However much supporting evidence there is, it is a suggestion.
      expect(
        await record("title", "VP Security", [
          ...SUPPORTING,
          ...saw("web.cited-claim", "employer-only"),
        ]),
      ).toMatchObject({ stored: true, applied: false, band: "PROBABLE" });
      expect(await contactRow("title")).toEqual({ title: "Head of Security" });

      expect(await record("title", "CISO", PRIMARY)).toMatchObject({
        applied: true,
      });
      expect(await contactRow("title")).toEqual({ title: "CISO" });
      expect(await facts("title")).toEqual([
        { value: "CISO", status: "APPLIED" },
        { value: "Head of Security", status: "SUPERSEDED" },
        { value: "VP Security", status: "SUPERSEDED" },
      ]);
    });

    it("never overwrites a person's value, including a correction of the agent's", async () => {
      await database.exec(
        `UPDATE contact SET github_url = 'https://github.com/typed' WHERE id = 'c_a'`,
      );
      expect(
        await record("githubUrl", "https://github.com/found", PRIMARY),
      ).toMatchObject({ stored: false });

      await record("title", "Head of Security", PRIMARY);
      await database.exec(
        `UPDATE contact SET title = 'Head of Trust' WHERE id = 'c_a'`,
      );
      expect(await record("title", "VP Security", PRIMARY)).toMatchObject({
        stored: false,
        reason: says("A person already filled in title"),
      });
      expect(await record("title", "Head of Security", PRIMARY)).toMatchObject({
        stored: false,
        reason: says("took this value off"),
      });
      expect(await contactRow("github_url, title")).toEqual({
        github_url: "https://github.com/typed",
        title: "Head of Trust",
      });
    });

    it("offers a suggestion once, however its address is written", async () => {
      await record("twitterUrl", "https://x.com/pmarchetti", SUPPORTING);
      await record("twitterUrl", "https://x.com/paula", SUPPORTING);
      expect(
        await record("twitterUrl", "http://twitter.com/Paula/", SUPPORTING),
      ).toMatchObject({
        stored: false,
        reason: says("already in front of a rep"),
      });
      expect(await facts("twitterUrl")).toEqual([
        { value: "https://x.com/paula", status: "PROPOSED" },
        { value: "https://x.com/pmarchetti", status: "APPLIED" },
      ]);
    });

    it("never offers again a value a person dismissed", async () => {
      await record("title", "Head of Security", PRIMARY);
      await record("title", "Head of Trust", SUPPORTING);
      expect(
        await decideFact("org_a", {
          factId: await proposalId("Head of Trust"),
          accept: false,
          decidedById: "user_a",
        }),
      ).toMatchObject({ outcome: "decided", applied: false });
      expect(await record("title", "Head of Trust", SUPPORTING)).toMatchObject({
        stored: false,
        reason: says("dismissed"),
      });
    });

    it("applies a suggestion a person accepts, once", async () => {
      await record("title", "Head of Security", PRIMARY);
      await record("title", "Head of Trust", SUPPORTING);
      const factId = await proposalId("Head of Trust");
      const decision = { factId, accept: true, decidedById: "user_a" };

      expect(await decideFact("org_b", decision)).toEqual({
        outcome: "missing",
      });
      expect(await decideFact("org_a", decision)).toMatchObject({
        outcome: "decided",
        applied: true,
      });
      expect(await decideFact("org_a", decision)).toEqual({
        outcome: "settled",
      });
      expect(await contactRow("title")).toEqual({ title: "Head of Trust" });
      expect(await facts("title")).toEqual([
        { value: "Head of Security", status: "SUPERSEDED" },
        { value: "Head of Trust", status: "APPLIED" },
      ]);
    });

    it("names a placeholder contact, and never renames one a person named", async () => {
      expect(
        await record("name", "Paula Marchetti", saw("profile.email-match")),
      ).toMatchObject({ applied: true });
      expect(await contactRow("first_name, last_name")).toEqual({
        first_name: "Paula",
        last_name: "Marchetti",
      });
      expect(
        await record("name", "Paola Marchetta", saw("profile.email-match")),
      ).toMatchObject({ stored: false });
    });

    it("asks nobody about a field the record keeps no column for", async () => {
      await record("location", "Berlin", SUPPORTING);
      expect(await record("location", "Lisbon", SUPPORTING)).toMatchObject({
        stored: false,
        reason: says("no rep is asked"),
      });
      expect(await facts("location")).toEqual([
        { value: "Berlin", status: "APPLIED" },
      ]);
    });

    it("notices a job change from the employer it superseded", async () => {
      await record("employer", "Fleetio", saw("linkedin.employer-and-name"));
      await record("employer", "Comp AI", saw("linkedin.employer-and-name"));
      expect(await lastEmployerChange("org_a", "c_a")).toMatchObject({
        from: "Fleetio",
        to: "Comp AI",
      });
      expect(await lastEmployerChange("org_b", "c_a")).toBeNull();
    });

    it("fills a field a person cleared from the suggestion waiting on it", async () => {
      await record("title", "Head of Security", PRIMARY);
      await record("title", "VP Security", SUPPORTING);
      await record("title", "Security Lead", saw("web.cited-claim"));
      await database.exec(`UPDATE contact SET title = NULL WHERE id = 'c_a'`);

      await sweepAllBlankFacts();
      expect(await contactRow("title")).toEqual({ title: "VP Security" });
      expect(await facts("title")).toEqual([
        { value: "Head of Security", status: "SUPERSEDED" },
        { value: "Security Lead", status: "SUPERSEDED" },
        { value: "VP Security", status: "APPLIED" },
      ]);
    });

    it("settles a suggestion the record now says, and leaves one it contradicts", async () => {
      await record("linkedinUrl", "https://linkedin.com/in/pm", PRIMARY);
      await record("linkedinUrl", "https://linkedin.com/in/paula", SUPPORTING);
      await record("title", "Head of Security", PRIMARY);
      await record("title", "VP Security", SUPPORTING);
      await database.exec(
        `UPDATE contact SET linkedin_url = 'https://www.linkedin.com/in/paula/' WHERE id = 'c_a'`,
      );

      await sweepAllBlankFacts();

      expect(await facts("linkedinUrl")).toEqual([
        { value: "https://linkedin.com/in/paula", status: "SUPERSEDED" },
        { value: "https://linkedin.com/in/pm", status: "APPLIED" },
      ]);
      expect(await facts("title")).toEqual([
        { value: "Head of Security", status: "APPLIED" },
        { value: "VP Security", status: "PROPOSED" },
      ]);
    });

    it("keeps an organization's contacts out of another's facts", async () => {
      expect(await record("title", "Mole", PRIMARY, "org_b")).toMatchObject({
        stored: false,
        reason: "No such contact.",
      });
      expect(await database.rows("SELECT id FROM contact_fact")).toEqual([]);
      expect(await contactRow("title")).toEqual({ title: null });
    });
  });
}
