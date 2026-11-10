import { describe, expect, it } from "vitest";
import {
  getStandardErrorMessage,
  isRetryableError,
} from "@/client/lib/error-messages";
import { UserMessageError } from "@/shared/error-codes";

describe("getStandardErrorMessage", () => {
  const fallback = "Contacts could not be loaded.";

  it("shows the caller's fallback for an error nobody wrote for people", () => {
    expect(
      getStandardErrorMessage(new TypeError("Failed to fetch"), fallback),
    ).toBe(fallback);
    expect(
      getStandardErrorMessage(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
        fallback,
      ),
    ).toBe(fallback);
    // A server fault says nothing of its own either.
    expect(getStandardErrorMessage(new Error("INTERNAL_ERROR"), fallback)).toBe(
      fallback,
    );
  });

  it("keeps the server's words and each code's copy", () => {
    expect(
      getStandardErrorMessage(
        new UserMessageError(
          "CONFLICT",
          "Stripe already uses the domain stripe.com.",
        ),
        fallback,
      ),
    ).toBe("Stripe already uses the domain stripe.com.");
    expect(getStandardErrorMessage(new Error("FORBIDDEN"), fallback)).toBe(
      "Only an owner or an admin can do that.",
    );
  });
});

describe("isRetryableError", () => {
  it("is false only where asking again gets the same answer", () => {
    expect(isRetryableError(new Error("NOT_FOUND"))).toBe(false);
    expect(
      isRetryableError(new UserMessageError("FORBIDDEN", "Deals are off.")),
    ).toBe(false);
    expect(isRetryableError(new Error("UPSTREAM_UNAVAILABLE"))).toBe(true);
    expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
  });
});
