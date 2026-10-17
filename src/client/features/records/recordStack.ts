import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { RECORD_KINDS, type RecordRef } from "@/shared/records";

// The record sheets open over whatever page is current, as the CRM opens
// them: `record` in the URL lists them bottom first ("company:a,contact:b"),
// and `tab` is the top sheet's tab. A record opened from a sheet stacks on
// it, and the sheet's Back returns to the one under it. Opening the first
// adds a history entry, so the browser's back button closes the sheets.

export const RECORD_TABS = ["overview", "activity", "agent"] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

/** The most sheets a stack holds: deeper, the oldest drops off. */
const STACK_MAX = 10;

export function recordKey(ref: RecordRef): string {
  return `${ref.kind}:${ref.id}`;
}

function parseRef(raw: string): RecordRef | null {
  const separator = raw.indexOf(":");
  const kind = RECORD_KINDS.find(
    (candidate) => candidate === raw.slice(0, separator),
  );
  const id = raw.slice(separator + 1);
  return kind && id ? { kind, id } : null;
}

function parseStack(raw: string | undefined): RecordRef[] {
  if (!raw) return [];
  return raw.split(",").flatMap((part) => {
    const ref = parseRef(part.trim());
    return ref ? [ref] : [];
  });
}

/** The URL's `record` for a stack; undefined closes every sheet. */
function formatStack(stack: RecordRef[]): string | undefined {
  return stack.length > 0
    ? stack.slice(-STACK_MAX).map(recordKey).join(",")
    : undefined;
}

/**
 * The search params every signed-in page takes (validated on the `_app`
 * route). A stale or hand-edited link keeps what still parses.
 */
export const appSearchSchema = z.object({
  record: z
    .string()
    .transform((raw) => formatStack(parseStack(raw)))
    .optional()
    .catch(undefined),
  tab: z.enum(RECORD_TABS).optional().catch(undefined),
});

const appRoute = getRouteApi("/_app");

/** The open sheets, and the ways to open, go back and close them. */
export function useRecordStack() {
  const { record } = appRoute.useSearch();
  const navigate = useNavigate();
  const stack = parseStack(record);

  /** The URL's search with `next` as the open sheets, on their first tab. */
  const searchFor =
    (next: RecordRef[]) =>
    <TSearch extends object>(prev: TSearch) => ({
      ...prev,
      record: formatStack(next),
      tab: undefined,
    });
  const write = (next: RecordRef[], replace: boolean) =>
    void navigate({ to: ".", search: searchFor(next), replace });
  /** The stack with `ref` opened on top (moved there if it was open). */
  const withOnTop = (ref: RecordRef) => [
    ...stack.filter((entry) => recordKey(entry) !== recordKey(ref)),
    ref,
  ];

  return {
    stack,
    top: stack.at(-1),
    /** RecordLink's search: `ref` opened on top of the open sheets. */
    openSearch: (ref: RecordRef) => searchFor(withOnTop(ref)),
    /** Opens `ref` over the page, or on top of the open sheets. */
    open: (ref: RecordRef) => write(withOnTop(ref), stack.length > 0),
    /** Back to the sheet under the top one; with one sheet, closes it. */
    back: () => write(stack.slice(0, -1), true),
    close: () => write([], true),
  };
}

/** Opens a record's sheet over the current page from code. */
export function useOpenRecord() {
  return useRecordStack().open;
}

/** The top sheet's tab, kept in the URL. */
export function useRecordTab() {
  const { tab } = appRoute.useSearch();
  const navigate = useNavigate();
  return [
    tab ?? "overview",
    (next: RecordTab) =>
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          tab: next === "overview" ? undefined : next,
        }),
        replace: true,
      }),
  ] as const;
}
