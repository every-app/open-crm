import { describe, expect, it } from "vitest";
import { needsOnboarding } from "./onboarding";

// The gate both the app's layout and /onboarding read: it decides who is
// sent to the form and who is sent on into the CRM.
describe("needsOnboarding", () => {
  it("asks only an owner or an admin, and only until the workspace is set up", () => {
    expect(needsOnboarding({ onboarded: false, role: "owner" })).toBe(true);
    expect(needsOnboarding({ onboarded: false, role: "admin" })).toBe(true);
    // A member could not answer the form, so uses the CRM meanwhile.
    expect(needsOnboarding({ onboarded: false, role: "member" })).toBe(false);
    expect(needsOnboarding({ onboarded: true, role: "owner" })).toBe(false);
  });
});
