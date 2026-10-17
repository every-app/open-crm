import { describe, expect, it } from "vitest";
import { appSearchSchema } from "@/client/features/records/recordStack";

describe("the record stack in the URL", () => {
  it("opens what still parses of a stale or hand-edited link, the newest ten at most", () => {
    expect(
      appSearchSchema.parse({
        record: "company:acme,bogus,contact:,person:ana,deal:d1",
        tab: "nope",
      }),
    ).toEqual({ record: "company:acme,deal:d1", tab: undefined });
    expect(appSearchSchema.parse({ record: "bogus" }).record).toBeUndefined();

    const deep = Array.from({ length: 12 }, (_, index) => `deal:d${index}`);
    expect(
      appSearchSchema.parse({ record: deep.join(",") }).record?.split(","),
    ).toEqual(deep.slice(2));
  });
});
