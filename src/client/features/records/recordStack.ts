import { useCallback } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { DEAL_STAGES } from "@/shared/crm-enums";
import { isLosingStage } from "@/shared/deal-stages";
import { RECORD_KINDS, type RecordRef } from "@/shared/records";

// The record sheets open over whatever page is current, as the CRM opens
// them: `record` in the URL lists them bottom first ("company:a,contact:b"),
// and `tab` is the top sheet's tab. A record opened from a sheet stacks on
// it, and the sheet's Back returns to the one under it. Opening the first
// adds a history entry, so the browser's back button closes the sheets.
//
// The panels opened in a sheet or over the page are in the URL too, under
// the CRM's keys, so a refresh or a link brings them back:
//   add                    a company's quick-add form, "contact" or "deal"
//   timeline               the Activity tab's view; All when absent
//   emailThread            the email thread open on the timeline
//   thread                 the conversation with the agent open on the
//                          Agent tab, or "new"
//   manageFields           the fields sheet, on a kind of record's fields
//   manageField            the field it edits, by key, or "new"
//   k                      the quick switcher (⌘K)
//   closeDeal, closeStage  the reason a deal closing as lost or unqualified
//                          asks for
//   new                    a list's New company, contact or deal form
// They replace the history entry rather than add one, but for the New form,
// which adds one so Back closes it; opening or closing a record closes them
// all.

// Every sheet has Overview, Activity and Agent; a company's sheet adds
// Contacts and Deals, a contact's Deals and a deal's Contacts.
export const RECORD_TABS = [
  "overview",
  "contacts",
  "deals",
  "activity",
  "agent",
] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

/** A company's quick-add forms, each on the tab of what it adds. */
const QUICK_ADDS = ["contact", "deal"] as const;
type QuickAdd = (typeof QUICK_ADDS)[number];
const QUICK_ADD_TAB: Record<QuickAdd, RecordTab> = {
  contact: "contacts",
  deal: "deals",
};

/** The views of a record's timeline (its Activity tab). */
export const TIMELINE_VIEWS = [
  "all",
  "notes",
  "email",
  "meetings",
  "upcoming",
  "done",
] as const;
export type TimelineView = (typeof TIMELINE_VIEWS)[number];

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

/** An id or a key from the URL, as text: the router reads `?k=42` as 42. */
const textParam = z
  .union([z.string().min(1), z.number()])
  .transform(String)
  .optional()
  .catch(undefined);

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
  add: z.enum(QUICK_ADDS).optional().catch(undefined),
  timeline: z.enum(TIMELINE_VIEWS).optional().catch(undefined),
  emailThread: textParam,
  thread: textParam,
  manageFields: z.enum(RECORD_KINDS).optional().catch(undefined),
  manageField: textParam,
  k: z.boolean().optional().catch(undefined),
  new: z.boolean().optional().catch(undefined),
  closeDeal: textParam,
  closeStage: z
    .enum(DEAL_STAGES)
    .refine(isLosingStage)
    .optional()
    .catch(undefined),
});

export type AppSearch = z.infer<typeof appSearchSchema>;

/** The app's params, each a key of `appSearchSchema`. */
export const APP_SEARCH_KEYS = appSearchSchema.keyof().options;

/** Every panel closed, as opening or closing a record leaves them. */
const PANELS_CLOSED = {
  tab: undefined,
  add: undefined,
  timeline: undefined,
  emailThread: undefined,
  thread: undefined,
  manageFields: undefined,
  manageField: undefined,
  k: undefined,
  new: undefined,
  closeDeal: undefined,
  closeStage: undefined,
} satisfies Omit<Record<keyof AppSearch, undefined>, "record">;

const appRoute = getRouteApi("/_app");

/** The app's params: the open sheets and their panels. */
export function useAppSearch(): AppSearch {
  return appRoute.useSearch();
}

/** Sets some of the app's params, in place of the current history entry. */
export function useSetAppSearch() {
  const navigate = useNavigate();
  return useCallback(
    (update: Partial<AppSearch>) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, ...update }),
        replace: true,
      }),
    [navigate],
  );
}

/** The open sheets, and the ways to open, go back and close them. */
export function useRecordStack() {
  const { record, new: creating } = useAppSearch();
  const navigate = useNavigate();
  const stack = parseStack(record);

  /** The URL's search with `next` as the open sheets, on their first tab. */
  const searchFor =
    (next: RecordRef[]) =>
    <TSearch extends object>(prev: TSearch) => ({
      ...prev,
      record: formatStack(next),
      ...PANELS_CLOSED,
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
    /**
     * Opens `ref` over the page, or on top of the open sheets. The first
     * sheet adds a history entry, or takes the New form's (the record it
     * made).
     */
    open: (ref: RecordRef) =>
      write(withOnTop(ref), stack.length > 0 || creating === true),
    /** Back to the sheet under the top one; with one sheet, closes it. */
    back: () => write(stack.slice(0, -1), true),
    close: () => write([], true),
  };
}

/** Opens a record's sheet over the current page from code. */
export function useOpenRecord() {
  return useRecordStack().open;
}

/**
 * The top sheet's tab, kept in the URL: a quick-add form shows on its own
 * tab. Another tab closes the panels open on this one.
 */
export function useRecordTab() {
  const { tab, add } = useAppSearch();
  const setSearch = useSetAppSearch();
  return [
    add ? QUICK_ADD_TAB[add] : (tab ?? "overview"),
    (next: RecordTab) =>
      setSearch({
        tab: next === "overview" ? undefined : next,
        add: undefined,
        timeline: undefined,
        emailThread: undefined,
      }),
  ] as const;
}

/**
 * A list's New form: whether it's open, and opening or closing it. Opening
 * adds a history entry, so Back closes it.
 */
export function useNewForm() {
  const { new: open } = useAppSearch();
  const navigate = useNavigate();
  return [
    open === true,
    (next: boolean) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, new: next || undefined }),
        replace: !next,
      }),
  ] as const;
}

/** A company sheet's quick-add form: which is open, and opening or closing one. */
export function useQuickAdd() {
  const { add } = useAppSearch();
  const setSearch = useSetAppSearch();
  return [
    add,
    (next: QuickAdd | undefined) =>
      setSearch(next ? { add: next, tab: QUICK_ADD_TAB[next] } : { add: next }),
  ] as const;
}
