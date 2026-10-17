import { describe, expect, it } from "vitest";
import {
  externalParticipants,
  parseAddressList,
  splitName,
} from "./participants";

// The one gate between an address on a thread and a contact: who is never
// a person.
describe("externalParticipants", () => {
  it("keeps only outside people at work domains", () => {
    const people = parseAddressList(
      [
        '"Doe, Jane" <Jane@Globex.com>',
        "ana@acme.com",
        "colleague@acme.com",
        "pat@gmail.com",
        "noreply@globex.com",
        "sales+eu@globex.com",
        "c_1888abc0123456789abcdef01@group.calendar.google.com",
        "4f9a2c1e-1b2c-4d3e-8f9a-0b1c2d3e4f5a@globex.com",
        "bounce@em.sendgrid.net",
        "blocked@initech.com",
        "someone@suppressed.io",
        "Kim <kim@calendar.wayne.com>",
      ].join(", "),
    );

    const kept = externalParticipants(people, {
      ourAddresses: new Set(["ana@acme.com"]),
      ourDomains: new Set(["acme.com"]),
      suppressedEmails: new Set(["blocked@initech.com"]),
      suppressedDomains: new Set(["suppressed.io"]),
    });

    expect(kept).toEqual([
      { email: "jane@globex.com", name: "Doe, Jane" },
      // A company's own calendar subdomain is still a company.
      { email: "kim@calendar.wayne.com", name: "Kim" },
    ]);
  });
});

describe("splitName", () => {
  it("reads 'Last, First', and falls back to the address's words", () => {
    expect(splitName("Doe, Jane", "jane@globex.com")).toEqual({
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(splitName(null, "mary-ann.smith@globex.com")).toEqual({
      firstName: "Mary",
      lastName: "Ann Smith",
    });
  });
});
