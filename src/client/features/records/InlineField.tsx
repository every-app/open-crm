import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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

// A record sheet's properties, each edited in place: click the value, type,
// and Enter (or leaving the field) saves; Escape puts it back. A field saves
// only what changed, trimmed, and an emptied field saves "" (the server
// clears it). A placeholder shows only in the editor, so an example value is
// never mistaken for a saved one.

const ROW = "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2";
const LABEL = "truncate text-xs text-muted-foreground";
const CONTROL =
  "h-8 w-full justify-start border border-transparent px-2 font-normal hover:border-input hover:bg-transparent";

/** A property row: its label, then the value or its editor. */
function PropertyRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={ROW}>
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
      </label>
      <div className="min-w-0">{children}</div>
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
}: {
  label: string;
  value: string | null;
  onSave: (next: string) => void;
  saving?: boolean;
  placeholder?: string;
  type?: "text" | "url" | "email" | "tel" | "date";
  /** Beside a saved value: a link that opens it, for example. */
  trailing?: (value: string) => ReactNode;
  /** How a value reads when it isn't being edited: an amount in its currency. */
  format?: (value: string) => ReactNode;
}) {
  const id = useId();
  const field = useInlineDraft(value, onSave);
  // While saving, the typed value shows until the record comes back.
  const shown = saving ? field.draft.trim() : (value ?? "");

  return (
    <PropertyRow label={label} htmlFor={id}>
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
            if (event.key === "Enter") {
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
            className={CONTROL}
            pending={saving}
            onClick={field.edit}
          >
            {shown ? (
              <span className="truncate">{format ? format(shown) : shown}</span>
            ) : (
              <span className="truncate text-muted-foreground">Empty</span>
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
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
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
      className="h-auto min-h-16 w-full items-start justify-start border border-transparent px-2 py-2 text-left font-normal whitespace-pre-wrap hover:border-input hover:bg-transparent"
      pending={saving}
      onClick={field.edit}
    >
      {shown ? (
        <span className="min-w-0 text-sm text-pretty text-muted-foreground">
          {shown}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">Empty</span>
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
