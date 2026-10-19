import { describe, expect, it } from "vitest";
import { isEnter } from "./keyboard";

describe("isEnter", () => {
  it("doesn't take the Enter that picks an input method's candidate for a send", () => {
    const enter = {
      key: "Enter",
      keyCode: 13,
      nativeEvent: { isComposing: false },
    };
    expect(isEnter(enter)).toBe(true);
    expect(isEnter({ ...enter, nativeEvent: { isComposing: true } })).toBe(
      false,
    );
    // Safari: the composition has ended by the time this keydown arrives.
    expect(isEnter({ ...enter, keyCode: 229 })).toBe(false);
  });
});
