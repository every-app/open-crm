import { useStore } from "@tanstack/react-form";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/client/components/ui/input-group";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { useCreateActivity } from "@/client/features/activities/activityQueries";
import {
  ACTIVITY_PRESENTATION,
  endOfLocalDay,
} from "@/client/features/activities/activityFormat";
import { isEnter } from "@/client/lib/keyboard";
import type { RecordRef } from "@/shared/records";
import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_SUBJECT_MAX,
  COMPOSABLE_TYPES,
  type ComposableType,
} from "@/types/schemas/activities";

const PLACEHOLDER: Record<ComposableType, string> = {
  NOTE: "Log a note…",
  CALL: "Log a call…",
  EMAIL: "Log an email…",
  MEETING: "Log a meeting…",
  TASK: "Add a task…",
};

function recordIds(record: RecordRef) {
  return {
    companyId: record.kind === "company" ? record.id : undefined,
    contactId: record.kind === "contact" ? record.id : undefined,
    dealId: record.kind === "deal" ? record.id : undefined,
  };
}

function isComposableType(value: unknown): value is ComposableType {
  return COMPOSABLE_TYPES.some((type) => type === value);
}

/** The most a task's text (its subject) or anything else's (its body) holds. */
function textMax(type: ComposableType): number {
  return type === "TASK" ? ACTIVITY_SUBJECT_MAX : ACTIVITY_BODY_MAX;
}

/**
 * Logs what happened on `record`: a note, call, email or meeting, or a task
 * with a due date. ⌘/Ctrl+Enter logs it; Escape clears the draft.
 */
export function ActivityComposer({ record }: { record: RecordRef }) {
  const create = useCreateActivity();
  const form = useAppForm({
    defaultValues: { type: "NOTE" as ComposableType, text: "", due: "" },
    onSubmit: async ({ value, formApi }) => {
      const text = value.text.trim();
      if (!text || text.length > textMax(value.type)) return;
      const isTask = value.type === "TASK";
      await create.mutateAsync({
        ...recordIds(record),
        type: value.type,
        subject: isTask ? text : undefined,
        body: isTask ? undefined : text,
        dueAt: isTask && value.due ? endOfLocalDay(value.due) : undefined,
      });
      // The next one is likely the same kind.
      formApi.reset({ type: value.type, text: "", due: "" });
    },
  });
  const { type, text } = useStore(form.store, (state) => state.values);
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const isTask = type === "TASK";
  const tooLong = text.trim().length > textMax(type);

  return (
    <form.AppForm>
      <form.Form>
        <InputGroup>
          <form.Field name="text">
            {(field) => (
              <InputGroupTextarea
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                placeholder={PLACEHOLDER[type]}
                aria-label="What happened"
                className="min-h-16"
                onKeyDown={(event) => {
                  if (isEnter(event) && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                  // Escape clears a draft; with none, it closes the sheet.
                  if (event.key === "Escape" && field.state.value) {
                    event.stopPropagation();
                    form.reset({ type, text: "", due: "" });
                  }
                }}
              />
            )}
          </form.Field>
          <InputGroupAddon
            align="block-end"
            className="flex-wrap gap-2 border-t"
          >
            <form.Field name="type">
              {(field) => (
                <ToggleGroup
                  size="sm"
                  spacing={0}
                  value={[field.state.value]}
                  onValueChange={(next) => {
                    const [picked] = next;
                    if (isComposableType(picked)) field.handleChange(picked);
                  }}
                  aria-label="What to log"
                >
                  {COMPOSABLE_TYPES.map((option) => {
                    const { label, icon: Icon } = ACTIVITY_PRESENTATION[option];
                    return (
                      <ToggleGroupItem
                        key={option}
                        value={option}
                        aria-label={label}
                        className="aria-pressed:bg-primary/15 aria-pressed:text-primary"
                      >
                        <Icon />
                        <span className="max-sm:sr-only">{label}</span>
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>
              )}
            </form.Field>
            {isTask ? (
              <form.Field name="due">
                {(field) => (
                  <input
                    type="date"
                    aria-label="Due date"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    // The addon focuses the text on a click anywhere else.
                    onClick={(event) => event.stopPropagation()}
                    className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
                  />
                )}
              </form.Field>
            ) : null}
            {text.trim() ? (
              <div className="ml-auto flex items-center gap-2">
                {tooLong ? (
                  <span className="text-xs text-destructive">
                    {`At most ${textMax(type).toLocaleString("en-US")} characters.`}
                  </span>
                ) : null}
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="xs"
                  disabled={tooLong}
                  pending={submitting}
                >
                  {isTask
                    ? "Add task"
                    : `Log ${ACTIVITY_PRESENTATION[type].label.toLowerCase()}`}
                </InputGroupButton>
              </div>
            ) : null}
          </InputGroupAddon>
        </InputGroup>
      </form.Form>
    </form.AppForm>
  );
}
