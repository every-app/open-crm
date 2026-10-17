import type { EveryAppUser } from "@every-app/sdk/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The REST API end to end below the gateway: a verified identity in, the
// feature's schema and service, real SQL, JSON out.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { handleApiRequest } from "./handler";

/** A personal access token's identity: the gateway signs `channel: "api"`. */
function tokenUser(overrides: Partial<EveryAppUser> = {}): EveryAppUser {
  return {
    id: "user_a",
    email: "ana@a.test",
    orgId: "org_a",
    orgRole: "owner",
    channel: "api",
    actor: { sub: "pat:token_a" },
    scopes: ["*"],
    jti: "jti",
    ...overrides,
  };
}

const ana = tokenUser();
const bo = tokenUser({ id: "user_b", email: "bo@b.test", orgId: "org_b" });

async function call(
  user: EveryAppUser,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await handleApiRequest(
    new Request(`https://crm.test/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    user,
  );
  const json: unknown = await response.json();
  return { status: response.status, body: json };
}

async function createCompany(user: EveryAppUser, input: object) {
  const { body } = await call(user, "POST", "/companies", input);
  return z.object({ id: z.string() }).parse(body).id;
}

describe("REST API", () => {
  beforeEach(async () => {
    await testDb.exec(
      `DELETE FROM agent_task; DELETE FROM company; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await testDb.seedTwoOrganizations();
  });

  it("creates, updates, lists and archives a company through its service", async () => {
    const id = await createCompany(ana, {
      name: "Acme",
      domain: "https://www.acme.com/pricing",
    });

    // The path names the record; the body carries only what changes.
    await call(ana, "PATCH", `/companies/${id}`, { industry: "Software" });
    expect((await call(ana, "GET", `/companies/${id}`)).body).toMatchObject({
      id,
      domain: "acme.com",
      industry: "Software",
    });

    const listed = await call(ana, "POST", "/companies/search", { q: "acm" });
    expect(listed.body).toMatchObject({ total: 1, rows: [{ id }] });

    expect((await call(ana, "POST", `/companies/${id}/archive`)).status).toBe(
      200,
    );
    expect(
      (await call(ana, "POST", "/companies/search", {})).body,
    ).toMatchObject({ total: 0 });

    // A query string reads as the schema's types: `limit` is a number.
    expect(
      (await call(ana, "GET", "/activities/my-tasks?window=overdue&limit=5"))
        .status,
    ).toBe(200);
  });

  it("answers errors with their status and a stable body", async () => {
    expect(await call(ana, "POST", "/companies", { name: "" })).toMatchObject({
      status: 400,
      body: { code: "VALIDATION_ERROR", issues: [{ path: "name" }] },
    });
    expect(await call(ana, "GET", "/companies/nope")).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND", message: "No company with id nope." },
    });
    expect(await call(ana, "GET", "/nothing-here")).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
    await call(ana, "POST", "/companies", { name: "Acme", domain: "acme.com" });
    expect(
      await call(ana, "POST", "/companies", {
        name: "Acme 2",
        domain: "acme.com",
      }),
    ).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
  });

  it("keeps one organization's records out of another's reach by id", async () => {
    const acme = await createCompany(ana, { name: "Acme" });

    expect((await call(bo, "GET", `/companies/${acme}`)).status).toBe(404);
    expect(
      (await call(bo, "PATCH", `/companies/${acme}`, { name: "Mine" })).status,
    ).toBe(404);
    expect(
      (await call(bo, "POST", "/companies/search", {})).body,
    ).toMatchObject({ total: 0 });
    expect((await call(ana, "GET", `/companies/${acme}`)).body).toMatchObject({
      name: "Acme",
    });
  });

  it("lets a read-only token read and a member do only what their role may", async () => {
    const acme = await createCompany(ana, { name: "Acme" });
    await call(ana, "POST", `/companies/${acme}/archive`);

    const reader = tokenUser({ scopes: ["api:read"] });
    expect((await call(reader, "GET", `/companies/${acme}`)).status).toBe(200);
    expect(
      await call(reader, "POST", `/companies/${acme}/restore`),
    ).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });

    // Deleting forever is for owners and admins, as in the app.
    const member = tokenUser({ orgRole: "member" });
    expect((await call(member, "DELETE", `/companies/${acme}`)).status).toBe(
      403,
    );
    expect((await call(ana, "DELETE", `/companies/${acme}`)).status).toBe(200);
  });
});
