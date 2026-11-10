import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { revalidateLogic } from "@tanstack/react-form";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  ListStagesField,
  type StageDraft,
} from "@/client/features/lists/ListStagesField";
import { LIST_COLOR_LABELS } from "@/client/features/lists/listColors";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { createList, setListStages, updateList } from "@/serverFunctions/lists";
import type { ListEntity } from "@/shared/crm-enums";
import {
  LIST_COLORS,
  LIST_NAME_MAX,
  type ListColor,
  type ListTemplate,
} from "@/types/schemas/lists";

// Making a list, and changing one: its name, color, description, follow-up
// and (once it exists) its stages (ListStagesField).

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

/**
 * The dialog that makes a list, and opens it once made. It asks for a name
 * and what the list is of (companies when opened from the companies page);
 * the stages, follow-up and color wait behind "More options".
 */
export function CreateListDialog({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  const onCompanies = useLocation({
    select: (location) => location.pathname === "/companies",
  });
  const entity: ListEntity = onCompanies ? "COMPANY" : "CONTACT";
  const [more, setMore] = useState(false);
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
              <field.SelectField label="List of" items={ENTITY_ITEMS} />
            )}
          </form.AppField>
          {more ? (
            <>
              <form.AppField name="template">
                {(field) => (
                  <field.SelectField
                    label="Stages"
                    description="You can change them later."
                    items={TEMPLATE_ITEMS}
                  />
                )}
              </form.AppField>
              <form.Subscribe selector={(state) => state.values.entity}>
                {(listOf) => (
                  <form.AppField name="followUpDays">
                    {(field) => (
                      <field.TextField
                        label="Follow up after (days quiet)"
                        description={`${listOf === "CONTACT" ? "People" : "Companies"} at an open stage show as Due once nothing has happened with them for this long. Empty: never.`}
                        inputMode="numeric"
                        placeholder="30"
                      />
                    )}
                  </form.AppField>
                )}
              </form.Subscribe>
              <form.AppField name="color">
                {(field) => (
                  <field.SelectField label="Color" items={COLOR_ITEMS} />
                )}
              </form.AppField>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2.5 text-muted-foreground"
              onClick={() => setMore(true)}
            >
              <ChevronRight data-icon="inline-start" />
              More options
            </Button>
          )}
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

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
          <ListStagesField
            entity={list.entity}
            stages={stages}
            onChange={setStages}
          />
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
