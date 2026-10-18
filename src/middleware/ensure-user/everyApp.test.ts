import { describe, expect, it, vi } from "vitest";
import type * as sdk from "@every-app/sdk/server";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@every-app/sdk/server", async (importOriginal) => ({
  ...(await importOriginal<typeof sdk>()),
  getEveryAppUser: vi.fn(),
}));

import { getEveryAppUser } from "@every-app/sdk/server";
import { resolveEveryAppContext } from "./everyApp";

describe("resolveEveryAppContext", () => {
  it("refuses a token limited by scopes on the app's own server functions", async () => {
    // Otherwise a read-only token would write through the UI's RPC what the
    // gateway's MCP policy refuses it.
    vi.mocked(getEveryAppUser).mockResolvedValue({
      id: "user_a",
      email: "ana@a.test",
      orgId: "org_a",
      orgRole: "owner",
      channel: "api",
      actor: { sub: "pat:token_a" },
      scopes: ["crm:read"],
      jti: "jti",
    });
    await expect(resolveEveryAppContext(new Headers())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
