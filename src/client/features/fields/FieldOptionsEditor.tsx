import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ADD_OPTION } from "@/client/features/fields/fieldsCopy";
import { FIELD_OPTION_LABEL_MAX } from "@/shared/fields";

/** A select's option while it is edited: `id` once saved, `key` for React. */
export type DraftOption = { id?: string; key: string; label: string };

let nextKey = 0;

export function draftOption(option?: { id: string; label: string }) {
  nextKey += 1;
  return {
    id: option?.id,
    key: option?.id ?? `new-${nextKey}`,
    label: option?.label ?? "",
  };
}

/** What is wrong with a select's options, or null. */
export function optionsProblem(options: DraftOption[]): string | null {
  if (options.length === 0) return "A select needs at least one option.";
  const labels = options.map((option) => option.label.trim().toLowerCase());
  if (labels.some((label) => label === ""))
    return "Every option needs a label.";
  if (new Set(labels).size !== labels.length) {
    return "Two options can't have the same label.";
  }
  return null;
}

function moved<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * A select's options: rename in place, reorder, remove, add. Removing a saved
 * option retires it: records that hold it keep showing it.
 */
export function FieldOptionsEditor({
  options,
  onChange,
  error,
}: {
  options: DraftOption[];
  onChange: (options: DraftOption[]) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {options.map((option, index) => {
          const name = option.label.trim() || `option ${index + 1}`;
          return (
            <li key={option.key} className="flex items-center gap-1">
              <Input
                aria-label={`Option ${index + 1}`}
                className="h-8"
                maxLength={FIELD_OPTION_LABEL_MAX}
                value={option.label}
                onChange={(event) =>
                  onChange(
                    options.map((entry, at) =>
                      at === index
                        ? { ...entry, label: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => onChange(moved(options, index, index - 1))}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${name} down`}
                disabled={index === options.length - 1}
                onClick={() => onChange(moved(options, index, index + 1))}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${name}`}
                onClick={() =>
                  onChange(options.filter((_, at) => at !== index))
                }
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange([...options, draftOption()])}
      >
        <Plus data-icon="inline-start" />
        {ADD_OPTION}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
