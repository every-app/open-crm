import { describe, expect, it, vi } from "vitest";

// runBulk reads no database; the module it lives in imports one.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));

import { AppError, UserFacingError } from "@/server/lib/errors";
import { runBulk } from "./recordRules";

describe("runBulk", () => {
  it("says why it left a record alone in words written for people, never an internal error's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const refusals: Record<string, Error> = {
      taken: new UserFacingError(
        "CONFLICT",
        "Acme already uses the domain acme.com.",
      ),
      gone: new AppError("NOT_FOUND", "No company with id gone."),
      broken: new Error("D1_ERROR: no such table: company"),
    };
    const act = async (id: string) => {
      const refusal = refusals[id];
      if (refusal) throw refusal;
    };

    expect(await runBulk(["ok", "taken", "broken"], act)).toEqual({
      requested: 3,
      succeeded: 1,
      failed: 2,
      error: "CONFLICT",
      message: "Acme already uses the domain acme.com.",
    });
    expect(await runBulk(["gone"], act)).toMatchObject({
      error: "NOT_FOUND",
      message: null,
    });
    expect(await runBulk(["broken"], act)).toMatchObject({
      error: "INTERNAL_ERROR",
      message: null,
    });
  });
});
