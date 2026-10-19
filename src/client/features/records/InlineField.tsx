import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import { isEnter } from "@/client/lib/keyboard";

// A record sheet's properties, each edited in place: click the value, type,
// and Enter (or leaving the field) saves; Escape puts it back. A field saves
// only what changed, trimmed, and an emptied field saves "" (the server
// clears it). A placeholder shows only in the editor, so an example value is
// never mistaken for a saved one.

/** The column every property on a sheet lines up on, custom fields too. */
export const PROPERTY_ROW = "grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2";
export const PROPERTY_LABEL = "truncate text-xs text-muted-foreground";
/** A value that edits on click, looking like text until it's hovered. */
export const PROPERTY_CONTROL =
  "h-8 w-full justify-start border border-transparent px-2 text-sm font-normal hover:border-input hover:bg-transparent";

/**
 * A property row: its label, then the value or its editor, and under it
 * what the agent suggests for it.
 */
export function PropertyRow({
  label,
  htmlFor,
  suggestion,
  children,
}: {
  label: string;
  htmlFor?: string;
  suggestion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(PROPERTY_ROW, suggestion ? "items-start" : "items-center")}
    >
      <label
        htmlFor={htmlFor}
        className={cn(PROPERTY_LABEL, suggestion && "leading-8")}
      >
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {/* Under the value's text, its buttons on the section's edge. */}
        {suggestion ? <div className="pl-2">{suggestion}</div> : null}
      </div>
    </div>
  );
}

function useInlineDraft(value: string | null, onSave: (next: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  // Enter and then the editor's blur as it unmounts would commit twice;
  // Escape and then that blur would save what Escape threw away.
  const open = useRef(false);
  return {
    editing,
    draft,
    setDraft,
    edit: () => {
      open.current = true;
      setDraft(value ?? "");
      setEditing(true);
    },
    commit: () => {
      if (!open.current) return;
      open.current = false;
      setEditing(false);
      if (draft.trim() !== (value ?? "")) onSave(draft.trim());
    },
    cancel: (event: KeyboardEvent) => {
      // Escape puts the value back; it doesn't also close the sheet.
      event.stopPropagation();
      open.current = false;
      setDraft(value ?? "");
      setEditing(false);
    },
  };
}

export function InlineField({
  label,
  value,
  onSave,
  saving = false,
  placeholder,
  type = "text",
  trailing,
  format,
  suggestion,
}: {
  label: string;
  value: string | null;
  onSave: (next: string) => void;
  saving?: boolean;
  placeholder?: string;
  type?: "text" | "url" | "email" | "tel" | "date";
  /** Beside a saved value: where the agent found it, for example. */
  trailing?: (value: string) => ReactNode;
  /** How a value reads when it isn't being edited: an amount in its currency. */
  format?: (value: string) => ReactNode;
  /** Under the row: a value the agent suggests for it. */
  suggestion?: ReactNode;
}) {
  const id = useId();
  const field = useInlineDraft(value, onSave);
  // While saving, the typed value shows until the record comes back.
  const shown = saving ? field.draft.trim() : (value ?? "");

  return (
    <PropertyRow label={label} htmlFor={id} suggestion={suggestion}>
      {field.editing ? (
        <Input
          id={id}
          type={type}
          autoFocus
          value={field.draft}
          placeholder={placeholder}
          className="h-8 px-2"
          onChange={(event) => field.setDraft(event.target.value)}
          onBlur={field.commit}
          onKeyDown={(event) => {
            if (isEnter(event)) {
              event.preventDefault();
              field.commit();
            }
            if (event.key === "Escape") field.cancel(event);
          }}
        />
      ) : (
        <div className="flex min-w-0 items-center">
          <Button
            id={id}
            variant="ghost"
            size="sm"
            // It gives way to what sits beside it rather than overflow.
            className={cn(PROPERTY_CONTROL, "min-w-0 shrink")}
            pending={saving}
            onClick={field.edit}
          >
            {shown ? (
              <span className="truncate">{format ? format(shown) : shown}</span>
            ) : (
              <span className="truncate text-muted-foreground">—</span>
            )}
          </Button>
          {shown && trailing && !saving ? trailing(shown) : null}
        </div>
      )}
    </PropertyRow>
  );
}

/** Long text: Enter starts a new line, ⌘/Ctrl+Enter or leaving saves. */
export function InlineTextArea({
  label,
  value,
  onSave,
  saving = false,
  placeholder,
}: {
  label: string;
  value: string | null;
  onSave: (next: string) => void;
  saving?: boolean;
  placeholder?: string;
}) {
  const field = useInlineDraft(value, onSave);
  const shown = saving ? field.draft.trim() : (value ?? "");

  if (field.editing) {
    return (
      <Textarea
        aria-label={label}
        autoFocus
        value={field.draft}
        placeholder={placeholder}
        rows={4}
        onChange={(event) => field.setDraft(event.target.value)}
        onBlur={field.commit}
        onKeyDown={(event) => {
          if (isEnter(event) && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            field.commit();
          }
          if (event.key === "Escape") field.cancel(event);
        }}
      />
    );
  }
  return (
    <Button
      variant="ghost"
      aria-label={`Edit ${label.toLowerCase()}`}
      className={cn(
        "w-full justify-start border border-transparent px-2 text-left font-normal whitespace-pre-wrap hover:border-input hover:bg-transparent",
        // Text gets room; an empty one is a line, as an empty property is.
        shown ? "h-auto min-h-16 items-start py-2" : "h-8",
      )}
      pending={saving}
      onClick={field.edit}
    >
      {shown ? (
        <span className="min-w-0 text-sm text-pretty text-muted-foreground">
          {shown}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </Button>
  );
}

type Option = { value: string; label: string };

export function InlineSelectField({
  label,
  value,
  items,
  onSave,
  saving = false,
}: {
  label: string;
  value: string;
  items: Option[];
  onSave: (next: string) => void;
  saving?: boolean;
}) {
  const id = useId();
  return (
    <PropertyRow label={label} htmlFor={id}>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null && next !== value) onSave(next);
        }}
        disabled={saving}
      >
        <SelectTrigger
          id={id}
          size="sm"
          className="h-8 w-full border-transparent bg-transparent px-2 shadow-none hover:border-input"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropertyRow>
  );
}
