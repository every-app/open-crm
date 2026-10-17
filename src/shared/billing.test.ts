import { describe, expect, it } from "vitest";
import { creditsForProviderUsd } from "./billing";

describe("creditsForProviderUsd", () => {
  it("bills a provider cost with the 28% markup, in whole credits at 1,000 to the dollar, rounded up", () => {
    // $0.05 of model spend is $0.064 billed.
    expect(creditsForProviderUsd(0.05)).toBe(64);
    // A Context.dev brand lookup: 10 credits at $0.0025.
    expect(creditsForProviderUsd(0.025)).toBe(32);
    // The markup is rounded to 5 places before the ceiling.
    expect(creditsForProviderUsd(0.123456)).toBe(159);
    // Any spend costs at least a credit; none costs nothing.
    expect(creditsForProviderUsd(0.0001)).toBe(1);
    expect(creditsForProviderUsd(0)).toBe(0);
  });
});
