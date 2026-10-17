import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/client/components/ui/button";
import { fullName } from "@/client/features/companies/companyFormat";
import { companyQueryOptions } from "@/client/features/companies/companyQueries";
import { contactQueryOptions } from "@/client/features/contacts/contactQueries";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { FIELD_ENTITIES } from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";
import { toolVerb, type Step } from "./agentSteps";

// A step the agent waits on the rep to allow, in place of the composer: the
// CRM's sensitive writes, which pause for a person in a chat and are refused
// unattended (`needsApproval` on record_job_change and archive_field). The
// request is worded from the tool's input, names looked up as the rest of
// the app shows them.

// What each gated tool asks to do, before it has done it.
const ASKS: Record<string, string> = {
  record_job_change: "Raise a job change",
  archive_field: "Archive a custom field",
};

/**
 * The transcript's line for a gated call: waiting on the rep, or what they
 * answered. Settled either way; the request itself is asked in place of the
 * composer.
 */
export function approvalStep(
  tool: string,
  answer: "waiting" | "approved" | "denied",
): Step {
  const ask = ASKS[tool] ?? toolVerb(tool);
  return {
    label:
      answer === "waiting"
        ? `${ask} — waiting for your approval`
        : `${ask} — you ${answer} it`,
    tone: "neutral",
    sources: [],
  };
}

const jobChangeInput = z.object({
  contactId: z.string(),
  moveToCompanyId: z.string().optional(),
});

const archiveFieldInput = z.object({
  entity: z.enum(FIELD_ENTITIES),
  key: z.string(),
});

export function ApprovalPrompt({
  tool,
  input,
  pending,
  onDecide,
}: {
  tool: string;
  input: unknown;
  pending: boolean;
  onDecide: (approved: boolean) => void;
}) {
  const jobChange =
    tool === "record_job_change" ? jobChangeInput.safeParse(input) : null;
  const archive =
    tool === "archive_field" ? archiveFieldInput.safeParse(input) : null;
  return (
    <div
      role="group"
      aria-label="The agent needs your approval"
      className="space-y-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      {jobChange?.success ? (
        <JobChangeRequest {...jobChange.data} />
      ) : archive?.success ? (
        <ArchiveFieldRequest
          entity={archive.data.entity}
          fieldKey={archive.data.key}
        />
      ) : (
        <Request
          title={`Let the agent go ahead: ${toolVerb(tool).toLowerCase()}?`}
          detail="It changes the CRM, so it waits for you."
        />
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onDecide(false)}
        >
          Deny
        </Button>
        <Button size="sm" pending={pending} onClick={() => onDecide(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}

function Request({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function JobChangeRequest({
  contactId,
  moveToCompanyId,
}: z.infer<typeof jobChangeInput>) {
  const contact = useQuery(contactQueryOptions(contactId));
  const company = useQuery({
    ...companyQueryOptions(moveToCompanyId ?? ""),
    enabled: moveToCompanyId !== undefined,
  });
  const name = contact.data ? fullName(contact.data) : "this contact";
  const moving = moveToCompanyId
    ? ` and move them to ${company.data?.name ?? "the company they joined"}`
    : "";
  return (
    <Request
      title={`Raise a job change for ${name}${moving}?`}
      detail="It goes on their timeline, where their owner sees it: a champion in a new seat is a warm introduction, and the seat they left is a relationship nobody owns yet."
    />
  );
}

function ArchiveFieldRequest({
  entity,
  fieldKey,
}: {
  entity: z.infer<typeof archiveFieldInput>["entity"];
  fieldKey: string;
}) {
  const fields = useQuery(fieldsQueryOptions(entity, true));
  const label =
    fields.data?.find((field) => field.key === fieldKey)?.label ?? fieldKey;
  return (
    <Request
      title={`Archive the “${label}” field on ${ENTITY_NOUNS[entity].many}?`}
      detail="It leaves every sheet and table and stops being filled. The values already recorded are kept."
    />
  );
}
