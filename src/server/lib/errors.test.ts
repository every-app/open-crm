import { describe, expect, it } from "vitest";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { AppError, UserFacingError, toClientError } from "@/server/lib/errors";

describe("errors sent to the browser", () => {
  it("carry a message written for people, and no other", () => {
    const shown = (error: unknown) =>
      getStandardErrorMessage(toClientError(error));
    const copyFor = (code: string) => getStandardErrorMessage(new Error(code));

    expect(
      shown(
        new UserFacingError(
          "CONFLICT",
          "Stripe already uses the domain stripe.com.",
        ),
      ),
    ).toBe("Stripe already uses the domain stripe.com.");
    // Anything else shows its code's copy, never the server's words.
    expect(shown(new AppError("NOT_FOUND", "No company with id c_1."))).toBe(
      copyFor("NOT_FOUND"),
    );
    expect(
      shown(new Error("D1_ERROR: UNIQUE constraint failed: company.domain")),
    ).toBe(copyFor("INTERNAL_ERROR"));
  });
});
