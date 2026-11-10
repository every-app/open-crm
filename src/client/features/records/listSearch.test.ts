import { describe, expect, it } from "vitest";
import { contactListSearchSchema } from "@/client/features/contacts/contactSearch";
import { dealListSearchSchema } from "@/client/features/deals/dealSearch";
import {
  savedViewOf,
  searchFromSavedView,
} from "@/client/features/records/listSearch";

describe("saved views and lists", () => {
  it("saves the filters set inside a list, not the list, its stage tab, Due or board", () => {
    expect(
      savedViewOf({
        q: "ana",
        owner: ["u1"],
        page: 3,
        record: "contact:c1",
        list: "l1",
        stage: ["s1"],
        listDue: true,
        view: "board",
      }),
    ).toEqual({ q: "ana", owner: ["u1"] });
  });

  it("keeps the deals list's stage filter, which shares the list stage's key", () => {
    expect(
      savedViewOf(dealListSearchSchema.parse({ stage: ["DEMO_BOOKED"] })),
    ).toMatchObject({ stage: ["DEMO_BOOKED"] });
  });

  it("applies a view inside a list without leaving the list or its stage tab", () => {
    expect(
      searchFromSavedView(
        contactListSearchSchema,
        // A view from before lists were left out of them.
        { q: "ana", list: "other", stage: ["other-stage"], view: "board" },
        { record: "contact:c1", list: "l1", stage: ["s1"] },
      ),
    ).toMatchObject({
      q: "ana",
      record: "contact:c1",
      list: "l1",
      stage: ["s1"],
      listDue: undefined,
      view: undefined,
    });
  });
});
