import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { revalidateLogic } from "@tanstack/react-form";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { LIST_COLOR_LABELS } from "@/client/features/lists/listColors";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { createList, setListStages, updateList } from "@/serverFunctions/lists";
import {
  STAGE_KINDS,
  type ListEntity,
  type StageKind,
} from "@/shared/crm-enums";
import {
  LIST_COLORS,
  LIST_NAME_MAX,
  LIST_STAGES_MAX,
  STAGE_NAME_MAX,
  type ListColor,
  type ListTemplate,
} from "@/types/schemas/lists";

// Making a list, and changing one: its name, color, description, follow-up
// and (once it exists) its stages.

const ENTITY_ITEMS: { value: ListEntity; label: string }[] = [
  { value: "CONTACT", label: "People" },
  { value: "COMPANY", label: "Companies" },
];

const TEMPLATE_ITEMS: { value: ListTemplate; label: string }[] = [
  {
    value: "OUTREACH",
    label: "Outreach: To contact → Contacted → Replied → Done",
  },
  { value: "NETWORKING", label: "Networking: To meet → Met → Keep in touch" },
  { value: "PLAIN", label: "Plain: no stages, a group like a tag" },
];

const COLOR_ITEMS = LIST_COLORS.map((color) => ({
  value: color,
  label: LIST_COLOR_LABELS[color],
}));

const KIND_LABELS: Record<StageKind, string> = {
  OPEN: "Open",
  DONE: "Done",
  DROPPED: "Dropped",
};

/** "" is off; otherwise whole days from 1 to 365. */
const followUpSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" ||
      (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365),
    "Days from 1 to 365, or empty for none.",
  );

const followUpOf = (value: string) =>
  value.trim() === "" ? null : Number(value);

const listFormSchema = z.object({
  name: z.string().trim().min(1, "A list needs a name.").max(LIST_NAME_MAX),
  entity: z.enum(["CONTACT", "COMPANY"]),
  template: z.enum(["OUTREACH", "NETWORKING", "PLAIN"]),
  color: z.enum(LIST_COLORS),
  description: z.string().max(500),
  followUpDays: followUpSchema,
});

/** The dialog that makes a list, and opens it once made. */
export function CreateListDialog({
  entity = "CONTACT",
  onClose,
}: {
  entity?: ListEntity;
  onClose: () => void;
}) {
  const formId = useId();
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  const create = useMutation({
    mutationFn: (values: z.infer<typeof listFormSchema>) =>
      createList({
        data: {
          entity: values.entity,
          name: values.name.trim(),
          color: values.color,
          description: values.description.trim() || null,
          followUpDays: followUpOf(values.followUpDays),
          template: values.template,
        },
      }),
    onSuccess: async (list) => {
      await invalidate();
      toast.success(`${list.name} created.`);
      onClose();
      void navigate({
        to: list.entity === "CONTACT" ? "/contacts" : "/companies",
        search: { list: list.id },
      });
    },
  });
  const form = useAppForm({
    defaultValues: {
      name: "",
      entity,
      template: "OUTREACH" as ListTemplate,
      color: "blue" as ListColor,
      description: "",
      followUpDays: "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: listFormSchema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value);
    },
  });

  return (
    <form.AppForm>
      <FormDialog
        title="New list"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={formId}>Create list</form.SubmitButton>
          </>
        }
      >
        <form.Form id={formId} className="space-y-4">
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                placeholder="Backlink outreach"
                maxLength={LIST_NAME_MAX}
                autoFocus
              />
            )}
          </form.AppField>
          <form.AppField name="entity">
            {(field) => (
              <field.SelectField label="Holds" items={ENTITY_ITEMS} />
            )}
          </form.AppField>
          <form.AppField name="template">
            {(field) => (
              <field.SelectField
                label="Stages"
                description="Edit them any time from the list's menu."
                items={TEMPLATE_ITEMS}
              />
            )}
          </form.AppField>
          <form.AppField name="followUpDays">
            {(field) => (
              <field.TextField
                label="Follow up after (days quiet)"
                description="People at an open stage show as Due once nothing has happened with them for this long. Empty: never."
                inputMode="numeric"
                placeholder="30"
              />
            )}
          </form.AppField>
          <form.AppField name="color">
            {(field) => <field.SelectField label="Color" items={COLOR_ITEMS} />}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

type StageDraft = { key: string; id?: string; name: string; kind: StageKind };

/** The dialog that changes a list: its details and its stages. */
export function EditListDialog({
  list,
  onClose,
}: {
  list: ListSummary;
  onClose: () => void;
}) {
  const formId = useId();
  const invalidate = useInvalidateRecords();
  const [stages, setStages] = useState<StageDraft[]>(
    list.stages.map((stage) => ({ key: stage.id, ...stage })),
  );
  const stagesChanged =
    JSON.stringify(stages.map(({ id, name, kind }) => ({ id, name, kind }))) !==
    JSON.stringify(
      list.stages.map(({ id, name, kind }) => ({ id, name, kind })),
    );
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof editFormSchema>) => {
      await updateList({
        data: {
          id: list.id,
          name: values.name.trim(),
          color: values.color,
          description: values.description.trim() || null,
          followUpDays: followUpOf(values.followUpDays),
        },
      });
      if (stagesChanged) {
        await setListStages({
          data: {
            listId: list.id,
            stages: stages.map(({ id, name, kind }) => ({
              id,
              name: name.trim(),
              kind,
            })),
          },
        });
      }
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("List saved.");
      onClose();
    },
  });
  const form = useAppForm({
    defaultValues: {
      name: list.name,
      color: list.color,
      description: list.description ?? "",
      followUpDays: list.followUpDays?.toString() ?? "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: editFormSchema },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });

  const move = (index: number, by: -1 | 1) =>
    setStages((current) => {
      const next = [...current];
      const [stage] = next.splice(index, 1);
      if (stage) next.splice(index + by, 0, stage);
      return next;
    });
  const patch = (index: number, change: Partial<StageDraft>) =>
    setStages((current) =>
      current.map((stage, at) =>
        at === index ? { ...stage, ...change } : stage,
      ),
    );
  const blankStage = stages.some((stage) => stage.name.trim() === "");

  return (
    <form.AppForm>
      <FormDialog
        title={`Edit ${list.name}`}
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={formId} disabled={blankStage}>
              Save
            </form.SubmitButton>
          </>
        }
      >
        <form.Form id={formId} className="space-y-4">
          <form.AppField name="name">
            {(field) => (
              <field.TextField label="Name" maxLength={LIST_NAME_MAX} />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => <field.TextareaField label="Description" rows={2} />}
          </form.AppField>
          <form.AppField name="followUpDays">
            {(field) => (
              <field.TextField
                label="Follow up after (days quiet)"
                description="Empty: never."
                inputMode="numeric"
              />
            )}
          </form.AppField>
          <form.AppField name="color">
            {(field) => <field.SelectField label="Color" items={COLOR_ITEMS} />}
          </form.AppField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Stages</legend>
            {stages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stages: the list is a group, like a tag.
              </p>
            ) : null}
            <ol className="space-y-1.5">
              {stages.map((stage, index) => (
                <li key={stage.key} className="flex items-center gap-1.5">
                  <Input
                    aria-label={`Stage ${index + 1} name`}
                    className="h-8 flex-1"
                    maxLength={STAGE_NAME_MAX}
                    value={stage.name}
                    onChange={(event) =>
                      patch(index, { name: event.target.value })
                    }
                  />
                  <Select
                    items={STAGE_KINDS.map((kind) => ({
                      value: kind,
                      label: KIND_LABELS[kind],
                    }))}
                    value={stage.kind}
                    onValueChange={(kind) => {
                      if (kind) patch(index, { kind });
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Stage ${index + 1} kind`}
                      size="sm"
                      className="w-24"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${stage.name || "stage"} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${stage.name || "stage"} down`}
                    disabled={index === stages.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${stage.name || "stage"}`}
                    onClick={() =>
                      setStages((current) =>
                        current.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ol>
            {stages.length < LIST_STAGES_MAX ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setStages((current) => [
                    ...current,
                    { key: crypto.randomUUID(), name: "", kind: "OPEN" },
                  ])
                }
              >
                <Plus data-icon="inline-start" />
                Add stage
              </Button>
            ) : null}
          </fieldset>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

const editFormSchema = listFormSchema.pick({
  name: true,
  color: true,
  description: true,
  followUpDays: true,
});
