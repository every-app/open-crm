import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/client/components/ui/button";
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
import { normalizeUrl } from "@/shared/safe-url";

// A record sheet's properties, each edited in place: click the value, type,
// and Enter (or leaving the field) saves; Escape puts it back. A field saves
// only what changed, trimmed, and an emptied field saves "" (the server
// clears it). A save that fails leaves the editor open on what was typed. A
// placeholder shows only in the editor, so an example value is never
// mistaken for a saved one.

/** The column every property on a sheet lines up on, custom fields too. */
export const PROPERTY_ROW = "grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2";
export const PROPERTY_LABEL = "truncate text-xs text-muted-foreground";
/** A value that edits on click, looking like text until it's hovered. */
export const PROPERTY_CONTROL =
  "h-8 w-full justify-start border border-transparent px-2 text-sm font-normal hover:border-input hover:bg-transparent";

/** A property row: its label, then the value or its editor. */
export function PropertyRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(PROPERTY_ROW, "items-center")}>
      <label htmlFor={htmlFor} className={PROPERTY_LABEL}>
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Saves a field's new value. When it returns a promise that rejects, the
 * save failed (its toast says why) and the editor stays open.
 */
type Save = (next: string) => unknown;

type FieldType = "text" | "url" | "email" | "tel" | "date";

function useInlineDraft(value: string | null, onSave: Save) {
  // "failed": the editor a failed save left open, on what was typed. It
  // doesn't take the focus back from wherever the person went meanwhile.
  const [editing, setEditing] = useState<"typing" | "failed" | false>(false);
  const [draft, setDraft] = useState(value ?? "");
  // Enter and then the editor's blur as it unmounts would commit twice;
  // Escape and then that blur would save what Escape threw away.
  const open = useRef(false);
  return {
    editing,
    draft,
    setDraft,
    /** What the editor takes: the focus, only when it was clicked open. */
    editor: {
      autoFocus: editing === "typing",
      "aria-invalid": editing === "failed" ? true : undefined,
      onFocus: () => {
        open.current = true;
      },
    },
    edit: () => {
      open.current = true;
      setDraft(value ?? "");
      setEditing("typing");
    },
    commit: () => {
      if (!open.current) return;
      open.current = false;
      setEditing(false);
      if (draft.trim() === (value ?? "")) return;
      void Promise.resolve(onSave(draft.trim())).catch(() =>
        setEditing("failed"),
      );
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
  format,
}: {
  label: string;
  value: string | null;
  onSave: Save;
  saving?: boolean;
  placeholder?: string;
  type?: FieldType;
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
          {...field.editor}
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
          {value && !saving ? <ValueLink type={type} value={value} /> : null}
        </div>
      )}
    </PropertyRow>
  );
}

/**
 * The way out to a web address, an email address or a phone number, beside
 * its value, as a custom field of those types has: the value itself edits.
 */
function ValueLink({ type, value }: { type: FieldType; value: string }) {
  const link =
    type === "url"
      ? { href: normalizeUrl(value), icon: <ExternalLink />, label: "Open" }
      : type === "email"
        ? { href: `mailto:${value}`, icon: <Mail />, label: "Email" }
        : type === "tel"
          ? { href: `tel:${value}`, icon: <Phone />, label: "Call" }
          : null;
  if (!link?.href) return null;
  return (
    <a
      href={link.href}
      target={type === "url" ? "_blank" : undefined}
      rel="noreferrer"
      aria-label={`${link.label} ${value}`}
      className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
    >
      {link.icon}
    </a>
  );
}

/** Long text: Enter starts a new line, ⌘/Ctrl+Enter or leaving saves. */
export function InlineTextArea({
  label,
  value,
  onSave,
  saving = false,
}: {
  label: string;
  value: string | null;
  onSave: Save;
  saving?: boolean;
}) {
  const field = useInlineDraft(value, onSave);
  const shown = saving ? field.draft.trim() : (value ?? "");

  if (field.editing) {
    return (
      <Textarea
        aria-label={label}
        {...field.editor}
        value={field.draft}
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
        <span className="text-sm text-muted-foreground">
          Add a {label.toLowerCase()}
        </span>
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
