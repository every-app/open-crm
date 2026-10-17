import { describe, expect, it } from "vitest";
import { classifyTouch } from "./attribution";

// A referrer names a provider only at its registrable name, so a lookalike
// host can't put a trusted source in a report.
describe("classifyTouch", () => {
  const source = (referrer: string) => {
    const touch = classifyTouch({ referrer });
    return [touch.source, touch.medium];
  };

  it("matches providers on DNS labels, never on a substring", () => {
    expect(source("https://scholar.google.co.jp/")).toEqual([
      "Google",
      "organic",
    ]);
    expect(source("https://www.linkedin.com/feed")).toEqual([
      "LinkedIn",
      "social",
    ]);
    for (const lookalike of [
      "https://notgoogle.com/",
      "https://google.evil.com/",
      "https://google.com.phish.example/",
    ]) {
      expect(source(lookalike)[1]).toBe("referral");
    }
  });

  it("reads webmail as email before search, and an explicit utm_source first", () => {
    expect(source("https://mail.google.com/mail/u/0")).toEqual([
      "Gmail",
      "email",
    ]);
    expect(
      classifyTouch({
        source: "newsletter",
        medium: "ppc",
        referrer: "https://google.com",
      }),
    ).toMatchObject({ source: "newsletter", medium: "cpc" });
    expect(classifyTouch({})).toMatchObject({
      source: "Direct",
      medium: "direct",
    });
  });
});
