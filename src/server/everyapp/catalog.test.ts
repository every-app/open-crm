import { beforeAll, describe, expect, it, vi } from "vitest";

// The catalog as the gateway reads it, and what each scope may call: a
// read-only connection gets every read, a read-write one every write, and
// nobody a destructive tool (the gateway never mints mcp:destructive).
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

import {
  READ_WRITE,
  call,
  catalog,
  failure,
} from "@/server/everyapp/toolTestSupport";

describe("the MCP catalog", () => {
  beforeAll(() => testDb.seedTwoOrganizations());

  it("describes every tool, and marks read exactly the tools that only read", async () => {
    const { tools, warnings } = await catalog();
    expect(warnings).toBeUndefined();
    const reads = tools
      .filter((tool) => tool.risk === "read")
      .map((tool) => tool.name);
    // Every lister and getter is visible to a read-only connection,
    // the record lists included.
    expect(reads).toEqual(
      tools
        .map((tool) => tool.name)
        .filter((name) => /^(list|get|search)_/.test(name)),
    );
    expect(reads).toEqual(
      expect.arrayContaining(["list_companies", "list_contacts", "list_deals"]),
    );
    // What deletes for good, or sets archived records to be deleted, is
    // destructive: the gateway hides it from every connection.
    expect(
      new Set(
        tools
          .filter((tool) => tool.risk === "destructive")
          .map((tool) => tool.name),
      ),
    ).toEqual(
      new Set([
        "bulk_purge",
        "delete_activity",
        "delete_field",
        "delete_saved_view",
        "set_archive_retention",
      ]),
    );
    // The gateway serves at most 100 tools an app, and drops a tool whose
    // input or output schema is over 20 KiB.
    expect(tools.length).toBeLessThanOrEqual(100);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toMatchObject({ type: "object" });
      for (const schema of [tool.inputSchema, tool.outputSchema]) {
        expect(JSON.stringify(schema).length, tool.name).toBeLessThan(
          20 * 1024,
        );
      }
    }
  });

  it("lets a read-only scope read and refuses it writes; refuses destructive tools to everyone", async () => {
    const readOnly = { scopes: ["mcp:read"] };
    await expect(call("list_companies", {}, readOnly)).resolves.toMatchObject({
      total: 0,
    });
    expect(
      await failure("create_company", { name: "Acme" }, readOnly),
    ).toContain("mcp:write");
    expect(
      await failure("delete_field", { id: "x" }, { scopes: READ_WRITE }),
    ).toContain("mcp:destructive");
  });
});
