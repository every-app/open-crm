import { useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import type { FieldType } from "@/shared/crm-enums";
import {
  parseFieldValue,
  type FieldValueJson,
  type ValueField,
} from "@/shared/fields";
import { safeHttpUrl } from "@/shared/safe-url";

type DisplayField = {
  type: FieldType;
  options: readonly { id: string; label: string }[];
};

// A fixed locale, as elsewhere in the app, so the server render and the
// browser agree.
const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});
// A date field's day is stored as that day's UTC midnight: show it in UTC.
const dayFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatValue(field: DisplayField, value: string | number | boolean) {
  switch (field.type) {
    case "CHECKBOX":
      return value === true ? "Yes" : "No";
    case "NUMBER":
      return typeof value === "number"
        ? numberFormat.format(value)
        : String(value);
    case "DATE": {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime())
        ? String(value)
        : dayFormat.format(date);
    }
    case "SELECT":
      // A table value is already the option's label.
      return (
        field.options.find((option) => option.id === value)?.label ??
        String(value)
      );
    default:
      return String(value);
  }
}

function MemberName({ userId }: { userId: string }) {
  const { data: members } = useQuery(membersQueryOptions());
  if (!members) return null;
  return (
    <>
      {members.find((member) => member.userId === userId)?.name ??
        "Former member"}
    </>
  );
}

/** A field value read-only: on a record, in a table cell. */
export function FieldValueDisplay({
  field,
  value,
  className,
}: {
  field: DisplayField;
  value: FieldValueJson;
  className?: string;
}) {
  if (value === null || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "truncate",
        field.type === "NUMBER" && "tabular-nums",
        className,
      )}
    >
      {field.type === "USER" ? (
        <MemberName userId={String(value)} />
      ) : (
        formatValue(field, value)
      )}
    </span>
  );
}

type EditorProps = {
  field: ValueField & DisplayField;
  /** The value shown: the saved one, or the one being saved. */
  value: FieldValueJson;
  saving: boolean;
  onSave: (value: FieldValueJson) => void;
  /** The id of the element that names the field. */
  labelId: string;
};

const NONE = "__none__";

/** A field value on a record, edited in place: click, change, Enter. */
export function InlineFieldValue(props: EditorProps) {
  const { field, value, saving, onSave, labelId } = props;
  switch (field.type) {
    case "CHECKBOX":
      return (
        <div className="flex h-8 items-center gap-2 px-2">
          <Checkbox
            checked={value === true}
            disabled={saving}
            aria-labelledby={labelId}
            onCheckedChange={(checked) => onSave(checked)}
          />
          {saving ? <Spinner className="size-3.5" /> : null}
        </div>
      );
    case "SELECT":
      return (
        <ChoiceValue
          {...props}
          noneLabel="None"
          choices={field.options.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
        />
      );
    case "USER":
      return <MemberValue {...props} />;
    default:
      return <TextValue {...props} />;
  }
}

function ChoiceValue({
  value,
  saving,
  onSave,
  labelId,
  choices,
  noneLabel,
}: EditorProps & {
  choices: { value: string; label: string }[];
  noneLabel: string;
}) {
  const items = [{ value: NONE, label: noneLabel }, ...choices];
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select
        items={items}
        value={typeof value === "string" ? value : NONE}
        disabled={saving}
        onValueChange={(next) =>
          onSave(typeof next === "string" && next !== NONE ? next : null)
        }
      >
        <SelectTrigger
          size="sm"
          aria-labelledby={labelId}
          className="w-full border-transparent bg-transparent px-2 hover:bg-muted"
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
      {saving ? <Spinner className="size-3.5" /> : null}
    </div>
  );
}

function MemberValue(props: EditorProps) {
  const { data: members } = useQuery(membersQueryOptions());
  const choices = (members ?? []).map((member) => ({
    value: member.userId,
    label: member.name,
  }));
  if (
    typeof props.value === "string" &&
    !choices.some((choice) => choice.value === props.value)
  ) {
    // Until the members load, the value has no name yet.
    choices.push({
      value: props.value,
      label: members ? "Former member" : "…",
    });
  }
  return <ChoiceValue {...props} choices={choices} noneLabel="Unassigned" />;
}

const INPUT_TYPES: Partial<Record<FieldType, string>> = {
  DATE: "date",
  URL: "url",
  EMAIL: "email",
  PHONE: "tel",
};

/** The way out to a URL, an email address or a phone number, beside its value. */
function ValueLink({ type, value }: { type: FieldType; value: string }) {
  const link =
    type === "URL"
      ? { href: safeHttpUrl(value), icon: <ExternalLink />, label: "Open" }
      : type === "EMAIL"
        ? { href: `mailto:${value}`, icon: <Mail />, label: "Email" }
        : type === "PHONE"
          ? { href: `tel:${value}`, icon: <Phone />, label: "Call" }
          : null;
  if (!link?.href) return null;
  return (
    <a
      href={link.href}
      target={type === "URL" ? "_blank" : undefined}
      rel="noreferrer"
      aria-label={`${link.label} ${value}`}
      className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
    >
      {link.icon}
    </a>
  );
}

function TextValue({ field, value, saving, onSave, labelId }: EditorProps) {
  const errorId = useId();
  // The text being typed; null while not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current =
    value === null
      ? ""
      : field.type === "DATE"
        ? String(value).slice(0, 10)
        : String(value);

  const cancel = () => {
    setDraft(null);
    setError(null);
  };
  const commit = () => {
    if (draft === null) return;
    const parsed = parseFieldValue(field, draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    cancel();
    if (parsed.value !== value) onSave(parsed.value);
  };

  if (draft !== null) {
    const shared = {
      autoFocus: true,
      value: draft,
      "aria-labelledby": labelId,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errorId : undefined,
      onBlur: commit,
    };
    return (
      <div className="space-y-1 py-0.5">
        {field.type === "LONG_TEXT" ? (
          <Textarea
            {...shared}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") cancel();
            }}
          />
        ) : (
          <Input
            {...shared}
            className="h-8"
            type={INPUT_TYPES[field.type] ?? "text"}
            inputMode={field.type === "NUMBER" ? "decimal" : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") cancel();
            }}
          />
        )}
        {error ? (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  let shown: ReactNode = <FieldValueDisplay field={field} value={value} />;
  if (field.type === "LONG_TEXT" && typeof value === "string") {
    shown = <span className="whitespace-pre-wrap">{value}</span>;
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-labelledby={labelId}
        disabled={saving}
        className="h-auto min-h-8 min-w-0 flex-1 justify-start px-2 py-1.5 text-left text-sm font-normal whitespace-normal"
        onClick={() => setDraft(current)}
      >
        {shown}
      </Button>
      {saving ? <Spinner className="size-3.5" /> : null}
      {!saving && typeof value === "string" && value ? (
        <ValueLink type={field.type} value={value} />
      ) : null}
    </div>
  );
}
