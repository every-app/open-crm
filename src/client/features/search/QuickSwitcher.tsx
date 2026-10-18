import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useSidebar } from "@/client/components/ui/sidebar";
import { Spinner } from "@/client/components/ui/spinner";
import { EntityLogo, PersonAvatar } from "@/client/features/records/cells";
import { useOpenRecord } from "@/client/features/records/recordStack";
import { quickSearchQueryOptions } from "@/client/features/search/searchQueries";
import { RECORD_KINDS, type RecordKind } from "@/shared/records";
import type { quickSearch } from "@/serverFunctions/search";
import { QUICK_SEARCH_MIN_LENGTH } from "@/types/schemas/search";

// The quick switcher: ⌘K (Ctrl+K) anywhere, or the search box at the top of
// the sidebar, then a few letters of a company, person or deal, and Enter
// opens it.

type Hit = Awaited<ReturnType<typeof quickSearch>>["hits"][number];

const GROUP_LABELS: Record<RecordKind, string> = {
  company: "Companies",
  contact: "Contacts",
  deal: "Deals",
};

const SEARCH_DELAY_MS = 200;

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

export function QuickSwitcher() {
  const openRecord = useOpenRecord();
  const { setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  // Every open starts from an empty search.
  const show = (next: boolean) => {
    setOpen(next);
    setInput("");
    setQuery("");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
        setInput("");
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuery(input.trim()),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [input]);

  const searching = query.length >= QUICK_SEARCH_MIN_LENGTH;
  const results = useQuery({
    ...quickSearchQueryOptions(query),
    enabled: open && searching,
  });
  const hits = searching ? (results.data?.hits ?? []) : [];
  const groups = RECORD_KINDS.map((kind) => ({
    value: kind,
    items: hits.filter((hit) => hit.kind === kind),
  })).filter((group) => group.items.length > 0);

  const go = (hit: Hit) => {
    show(false);
    // On a phone the sidebar this sits in covers the page: close it too, as
    // its links do.
    setOpenMobile(false);
    openRecord({ kind: hit.kind, id: hit.id });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => show(true)}
        // The shortcut shows when the row has room for it beside the queue.
        className="@container flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="hidden rounded border border-border px-1 font-sans text-[0.65rem] @[7rem]:inline">
          {IS_MAC ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={show}>
        <DialogContent
          showCloseButton={false}
          className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Jump to a company, contact or deal
          </DialogDescription>
          <Autocomplete.Root
            open
            inline
            items={groups}
            value={input}
            onValueChange={setInput}
            itemToStringValue={(hit: Hit) => hit.label}
            // The server already matched the search.
            filter={null}
            // The matches arrive after the typing: Enter opens the first.
            autoHighlight="always"
            keepHighlight
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              {results.isFetching ? (
                <Spinner className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Search
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <Autocomplete.Input
                // Typing straight after ⌘K lands here, not before the dialog
                // has moved focus.
                autoFocus
                placeholder="Search…"
                className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Autocomplete.Empty>
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {!searching
                  ? "Type at least two characters."
                  : results.isFetching
                    ? "Searching…"
                    : "Nothing matches."}
              </p>
            </Autocomplete.Empty>
            <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1 empty:p-0">
              {(group: { value: RecordKind; items: Hit[] }) => (
                <Autocomplete.Group key={group.value} items={group.items}>
                  <Autocomplete.GroupLabel className="px-2 py-1.5 text-xs text-muted-foreground">
                    {GROUP_LABELS[group.value]}
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(hit: Hit) => (
                      <Autocomplete.Item
                        key={`${hit.kind}:${hit.id}`}
                        value={hit}
                        onClick={() => go(hit)}
                        className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        {hit.kind === "contact" ? (
                          <PersonAvatar src={hit.imageUrl} name={hit.label} />
                        ) : (
                          <EntityLogo
                            src={hit.iconUrl}
                            darkSrc={hit.iconDarkUrl}
                            tone={hit.iconTone}
                            name={hit.label}
                          />
                        )}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{hit.label}</span>
                          {hit.detail ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {hit.detail}
                            </span>
                          ) : null}
                        </span>
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
          </Autocomplete.Root>
        </DialogContent>
      </Dialog>
    </>
  );
}
