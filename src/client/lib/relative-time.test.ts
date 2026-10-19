import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeDay } from "@/client/lib/relative-time";

/** The end of a day of October 2026 in the reader's time zone, as tasks are due. */
const dueOn = (day: number) =>
  new Date(2026, 9, day, 23, 59, 59, 999).toISOString();

describe("a task's due day", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads as its calendar day, morning and night alike", () => {
    vi.useFakeTimers();
    for (const hour of [0, 9, 23]) {
      vi.setSystemTime(new Date(2026, 9, 18, hour, 30));
      expect(
        [19, 18, 17, 15, 21].map((day) => formatRelativeDay(dueOn(day))),
      ).toEqual(["tomorrow", "today", "yesterday", "3 days ago", "in 3 days"]);
    }
  });
});
