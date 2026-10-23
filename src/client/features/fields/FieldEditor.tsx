import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { FieldDescription, FieldTitle } from "@/client/components/ui/field";
import {
  fieldCoverageQueryOptions,
  settleEntityFields,
} from "@/client/features/fields/fieldQueries";
import {
  FieldOptionsEditor,
  draftOption,
  optionsProblem,
} from "@/client/features/fields/FieldOptionsEditor";
import { Coverage, FieldHeader } from "@/client/features/fields/FieldSections";
import {
  AGENT_HELP,
  AGENT_LABEL,
  ARCHIVE,
  BRIEF_LABEL,
  CREATE_FIELD,
  FILTER_PLACEMENT,
  KEY_HELP,
  KEY_LABEL,
  LABEL_LABEL,
  NEW_FIELD,
  OPTIONS_LABEL,
  SAVE,
  SHEET_PLACEMENT,
  TABLE_PLACEMENT,
  TYPE_LABEL,
  TYPE_LOCKED,
} from "@/client/features/fields/fieldsCopy";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { getFieldError } from "@/client/lib/forms";
import type { Field } from "@/server/features/fields/services/fieldShape";
import {
  archiveField,
  createField,
  updateField,
} from "@/serverFunctions/fields";
import { FIELD_TYPES, type FieldEntity } from "@/shared/crm-enums";
import {
  FIELD_BRIEF_MAX,
  FIELD_LABEL_MAX,
  FIELD_TYPE_LABELS,
  fieldKeyFromLabel,
} from "@/shared/fields";

const draftSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "A field needs a label.")
      .max(FIELD_LABEL_MAX)
      .refine(
        (label) => fieldKeyFromLabel(label) !== "",
        "Use at least one letter or digit.",
      ),
    agentFilled: z.boolean(),
    agentBrief: z.string().max(FIELD_BRIEF_MAX),
    type: z.enum(FIELD_TYPES),
    options: z.array(
      z.object({
        id: z.string().optional(),
        key: z.string(),
        label: z.string(),
      }),
    ),
    showOnSheet: z.boolean(),
    showOnTable: z.boolean(),
    showOnFilter: z.boolean(),
  })
  .superRefine((draft, context) => {
    const problem =
      draft.type === "SELECT" ? optionsProblem(draft.options) : null;
    if (problem) {
      context.addIssue({ code: "custom", path: ["options"], message: problem });
    }
  });

type Draft = z.infer<typeof draftSchema>;

function draftFrom(field: Field | undefined): Draft {
  return {
    label: field?.label ?? "",
    agentFilled: field?.agentFilled ?? true,
    agentBrief: field?.agentBrief ?? "",
    type: field?.type ?? "TEXT",
    options: field?.options.map(draftOption) ?? [],
    showOnSheet: field?.showOnSheet ?? true,
    showOnTable: field?.showOnTable ?? false,
    showOnFilter: field?.showOnFilter ?? false,
  };
}

function settingsFrom(draft: Draft) {
  return {
    label: draft.label.trim(),
    agentFilled: draft.agentFilled,
    agentBrief: draft.agentBrief.trim() || null,
    type: draft.type,
    showOnSheet: draft.showOnSheet,
    showOnTable: draft.showOnTable,
    showOnFilter: draft.showOnFilter,
  };
}

const optionsFrom = (draft: Draft) =>
  draft.options.map((option) => ({
    id: option.id,
    label: option.label.trim(),
  }));

/**
 * Creates a field, or edits one: its label (the key follows, once), whether
 * and how the agent fills it, its type and options, and where it shows.
 */
export function FieldEditor({
  entity,
  field,
  onDone,
}: {
  entity: FieldEntity;
  field: Field | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [archiving, setArchiving] = useState(false);
  const coverage = useQuery({
    ...fieldCoverageQueryOptions(entity, field?.id ?? ""),
    enabled: Boolean(field),
  });
  const typeLocked = (coverage.data?.values ?? 0) > 0;
  const settle = () => settleEntityFields(queryClient, entity);

  const save = useMutation({
    mutationFn: (draft: Draft) =>
      field
        ? updateField({
            data: {
              id: field.id,
              ...settingsFrom(draft),
              options: draft.type === "SELECT" ? optionsFrom(draft) : undefined,
            },
          })
        : createField({
            data: {
              entity,
              ...settingsFrom(draft),
              options: draft.type === "SELECT" ? optionsFrom(draft) : [],
            },
          }),
    // The form shows field errors inline and toasts the rest itself.
    meta: { errorToast: false },
    onSuccess: async () => {
      await settle();
      onDone();
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveField({ data: { id } }),
    onSuccess: async () => {
      await settle();
      onDone();
    },
  });

  const form = useAppForm({
    defaultValues: draftFrom(field),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: draftSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value);
      } catch (error) {
        if (getErrorCode(error) === "CONFLICT") {
          formApi.setErrorMap({
            onSubmit: {
              fields: field
                ? { type: TYPE_LOCKED }
                : {
                    label:
                      "A field with this key already exists. It may be archived.",
                  },
            },
          });
        } else {
          toast.error(getStandardErrorMessage(error));
        }
      }
    },
  });

  return (
    <>
      <FieldHeader
        entity={entity}
        title={field?.label ?? NEW_FIELD}
        coverage={coverage.data}
        onBack={onDone}
      />

      <form.AppForm>
        <form.Form className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto p-4">
            <form.AppField name="label">
              {(input) => (
                <input.TextField
                  label={LABEL_LABEL}
                  maxLength={FIELD_LABEL_MAX}
                  autoFocus={!field}
                  required
                />
              )}
            </form.AppField>
            <form.AppField name="type">
              {(input) => (
                <input.SelectField
                  label={TYPE_LABEL}
                  description={typeLocked ? TYPE_LOCKED : undefined}
                  disabled={typeLocked}
                  items={FIELD_TYPES.map((type) => ({
                    value: type,
                    label: FIELD_TYPE_LABELS[type],
                  }))}
                />
              )}
            </form.AppField>
            <form.Subscribe selector={(state) => state.values.type}>
              {(type) =>
                type === "SELECT" ? (
                  <form.Field name="options">
                    {(input) => (
                      <div className="space-y-2">
                        <FieldTitle>{OPTIONS_LABEL}</FieldTitle>
                        <FieldOptionsEditor
                          options={input.state.value}
                          onChange={(options) => input.handleChange(options)}
                          error={getFieldError(input.state.meta.errors)}
                        />
                      </div>
                    )}
                  </form.Field>
                ) : null
              }
            </form.Subscribe>
            <form.AppField name="agentFilled">
              {(input) => (
                <input.SwitchField
                  label={AGENT_LABEL}
                  description={AGENT_HELP}
                />
              )}
            </form.AppField>
            <form.Subscribe selector={(state) => state.values.agentFilled}>
              {(enabled) =>
                enabled ? (
                  <details className="space-y-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Research instructions
                    </summary>
                    <form.AppField name="agentBrief">
                      {(input) => (
                        <input.TextareaField
                          label={BRIEF_LABEL}
                          maxLength={FIELD_BRIEF_MAX}
                          rows={3}
                        />
                      )}
                    </form.AppField>
                  </details>
                ) : null
              }
            </form.Subscribe>
            <details className="space-y-4 border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium">
                Advanced
              </summary>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <FieldTitle>{KEY_LABEL}</FieldTitle>
                  <form.Subscribe selector={(state) => state.values.label}>
                    {(label) => (
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {field?.key ?? (fieldKeyFromLabel(label) || "—")}
                      </span>
                    )}
                  </form.Subscribe>
                </div>
                <FieldDescription>{KEY_HELP}</FieldDescription>
              </div>
              <div className="space-y-2.5">
                <form.AppField name="showOnSheet">
                  {(input) => <input.CheckboxField label={SHEET_PLACEMENT} />}
                </form.AppField>
                <form.AppField name="showOnTable">
                  {(input) => <input.CheckboxField label={TABLE_PLACEMENT} />}
                </form.AppField>
                <form.AppField name="showOnFilter">
                  {(input) => <input.CheckboxField label={FILTER_PLACEMENT} />}
                </form.AppField>
              </div>
            </details>
            {field && coverage.data ? (
              <Coverage field={field} coverage={coverage.data} canFill />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t p-4">
            <form.SubmitButton>{field ? SAVE : CREATE_FIELD}</form.SubmitButton>
            {field ? (
              <Button variant="outline" onClick={() => setArchiving(true)}>
                {ARCHIVE}
              </Button>
            ) : (
              <Button variant="outline" onClick={onDone}>
                Cancel
              </Button>
            )}
          </div>
        </form.Form>
      </form.AppForm>

      {field && archiving ? (
        <ConfirmDialog
          title={`Archive ${field.label}?`}
          confirmLabel="Archive field"
          destructive
          pending={archive.isPending}
          onConfirm={() => archive.mutate(field.id)}
          onClose={() => setArchiving(false)}
        >
          {coverage.data
            ? `Its ${coverage.data.values} ${coverage.data.values === 1 ? "value is" : "values are"} kept.`
            : "Its values are kept."}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
