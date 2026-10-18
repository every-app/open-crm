import { describe, expect, it } from "vitest";
import { filterSummary } from "@/client/components/table/filterSummary";

describe("filterSummary", () => {
  it("names up to two values and counts the rest", () => {
    expect(filterSummary(["Ana Lee"])).toBe("Ana Lee");
    expect(filterSummary(["Software", "Logistics"])).toBe(
      "Software, Logistics",
    );
    expect(filterSummary(["Software", "Logistics", "Defense", "Retail"])).toBe(
      "Software, Logistics +2",
    );
  });
});
