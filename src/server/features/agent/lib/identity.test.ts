import { describe, expect, it } from "vitest";
import { verdictFor } from "./identity";
import type { Person } from "./people";

// Whether a profile is the person behind an address: it fails closed, so the
// edge cases are the ones that would put a stranger's career on a record.

const CLAIM = {
  email: "pmarchetti@fernhill.com",
  companyName: "Fernhill",
  companyDomain: "fernhill.com",
};

function role(name: string, domain: string | null) {
  return {
    title: "Head of Revenue",
    organisation: { name, domain },
    startDate: null,
    endDate: null,
    location: null,
    description: null,
    isCurrent: true,
  };
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    firstName: "Paula",
    lastName: "Marchetti",
    fullName: "Paula Marchetti",
    bio: null,
    location: null,
    email: null,
    photoUrl: null,
    profileUrl: null,
    socialUrls: [],
    websiteUrls: [],
    skills: [],
    currentRoles: [role("Fernhill", "fernhill.com")],
    experience: [],
    education: [],
    ...overrides,
  };
}

describe("verdictFor", () => {
  it("settles on the address the person published themselves", () => {
    expect(
      verdictFor(
        person({ email: "PMarchetti@Fernhill.com", currentRoles: [] }),
        CLAIM,
      ),
    ).toMatchObject({ emailMatches: true, isSamePerson: true });
  });

  it("needs the employer and the name together", () => {
    expect(verdictFor(person(), CLAIM)).toMatchObject({
      isSamePerson: true,
      confidence: "high",
    });
    expect(
      verdictFor(person({ firstName: "Antonio", lastName: "Fontana" }), CLAIM),
    ).toMatchObject({
      employerMatches: true,
      nameMatches: false,
      isSamePerson: false,
      confidence: "medium",
    });
  });

  it("matches an employer by name as well as by domain", () => {
    expect(
      verdictFor(
        person({ currentRoles: [role("Fernhill Bank", null)] }),
        CLAIM,
      ),
    ).toMatchObject({ employerMatches: true, isSamePerson: true });
  });

  it("refuses a hyphenated domain that only looks like the employer's", () => {
    expect(
      verdictFor(
        person({ currentRoles: [role("Acme", "fern-hill.com")] }),
        CLAIM,
      ),
    ).toMatchObject({ employerMatches: false, isSamePerson: false });
  });

  it("refuses a stranger who shares nothing", () => {
    expect(
      verdictFor(
        person({
          firstName: "Antonio",
          lastName: "Fontana",
          currentRoles: [role("Brightwater", "brightwater.example")],
        }),
        CLAIM,
      ),
    ).toMatchObject({ isSamePerson: false, confidence: "low" });
  });
});
