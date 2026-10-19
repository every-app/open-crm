/**
 * Whether a key press is an Enter that sends or saves, and not the Enter that
 * picks an input method's candidate (Chinese, Japanese, Korean) while the
 * text is still being composed. Safari ends the composition before that
 * Enter's keydown, which then shows only as key code 229.
 */
export function isEnter(event: {
  key: string;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return (
    event.key === "Enter" &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  );
}
