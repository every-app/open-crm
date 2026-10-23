import { useState } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, CircleDollarSign } from "lucide-react";
import { FormDialog } from "@/client/components/FormDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { useCreateActivity } from "@/client/features/activities/activityQueries";
import { endOfLocalDay } from "@/client/features/activities/activityFormat";
import { ACTIVITY_SUBJECT_MAX } from "@/types/schemas/activities";
import { FollowUpIllustration } from "./FollowUpIllustration";

const FORM_ID = "first-follow-up";
const schema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Add a next step.")
    .max(ACTIVITY_SUBJECT_MAX),
  due: z.iso.date({ error: "Choose a due date." }),
});

/** The first deal becomes useful when there is a dated next action. */
export function FirstFollowUp({
  deal,
}: {
  deal: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section
        aria-labelledby="first-follow-up-title"
        className="flex min-h-[30rem] flex-col items-center justify-center gap-7 rounded-xl border border-border bg-card px-6 py-12 text-center sm:min-h-[36rem] sm:rounded-2xl sm:px-12"
      >
        <FollowUpIllustration />
        <div className="w-full max-w-md space-y-3">
          <p className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary/5 px-3 py-1.5 text-sm text-primary">
            <CircleDollarSign className="size-4 shrink-0" />
            <span className="truncate">{deal.name}</span>
          </p>
          <h2
            id="first-follow-up-title"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Schedule your first follow-up
          </h2>
        </div>
        <Button size="lg" onClick={() => setOpen(true)}>
          Add follow-up
          <ArrowRight data-icon="inline-end" />
        </Button>
      </section>
      {open ? (
        <FollowUpDialog deal={deal} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function FollowUpDialog({
  deal,
  onClose,
}: {
  deal: { id: string; name: string };
  onClose: () => void;
}) {
  const create = useCreateActivity();
  const form = useAppForm({
    defaultValues: { subject: "", due: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync({
        type: "TASK",
        dealId: deal.id,
        subject: value.subject,
        dueAt: endOfLocalDay(value.due),
      });
      toast.success("Follow-up scheduled.");
      onClose();
    },
  });
  return (
    <form.AppForm>
      <FormDialog
        title="Add follow-up"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={FORM_ID}>
              Schedule follow-up
            </form.SubmitButton>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{deal.name}</p>
        <form.Form id={FORM_ID} className="flex flex-col gap-4">
          <form.AppField name="subject">
            {(field) => (
              <field.TextField
                label="Next step"
                autoFocus
                maxLength={ACTIVITY_SUBJECT_MAX}
                required
              />
            )}
          </form.AppField>
          <form.AppField name="due">
            {(field) => (
              <field.TextField label="Due date" type="date" required />
            )}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}
