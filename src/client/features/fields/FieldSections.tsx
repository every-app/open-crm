import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { BackButton } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { useAgentPaused } from "@/client/features/agent/AgentPaused";
import {
  ALL_FILLED,
  FILL,
  SHEET_TITLE,
} from "@/client/features/fields/fieldsCopy";
import type { Field } from "@/server/features/fields/services/fieldShape";
import { fillField } from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";

// What a field's editor and its read-only view both show: the header, and
// how much of the field is filled.

type FieldCoverage = { filled: number; total: number };

/** Back to the fields, then the field's name and how much of it is filled. */
export function FieldHeader({
  entity,
  title,
  coverage,
  onBack,
}: {
  entity: FieldEntity;
  title: string;
  coverage: FieldCoverage | undefined;
  onBack: () => void;
}) {
  const noun = ENTITY_NOUNS[entity];
  return (
    <SheetHeader className="border-b">
      <BackButton className="mb-1 self-start" onClick={onBack}>
        {SHEET_TITLE}
      </BackButton>
      <SheetTitle>{title}</SheetTitle>
      <SheetDescription>
        {coverage
          ? `${noun.title} · ${coverage.filled} of ${coverage.total} filled`
          : noun.title}
      </SheetDescription>
    </SheetHeader>
  );
}

/**
 * How much of the field is filled, and, for those who manage fields, the way
 * to ask the agent for the rest.
 */
export function Coverage({
  field,
  coverage,
  canFill,
}: {
  field: Field;
  coverage: FieldCoverage;
  canFill: boolean;
}) {
  const noun = ENTITY_NOUNS[field.entity];
  const left = coverage.total - coverage.filled;
  const paused = useAgentPaused();
  const fill = useMutation({
    mutationFn: () => fillField({ data: { id: field.id } }),
    onSuccess: ({ queued, merged }) => {
      const records = queued + merged;
      const count = `${records} ${records === 1 ? noun.one : noun.many}`;
      toast.success(
        records === 0
          ? "The agent is already working on these."
          : paused
            ? `Queued for ${count}. The agent fills it once its model is set up.`
            : `The agent will fill it on ${count}.`,
      );
    },
  });

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Filled on {coverage.filled} of {coverage.total} {noun.many}
        </p>
        <p className="text-xs text-muted-foreground">
          {left > 0 ? `${left} still to go` : ALL_FILLED}
        </p>
      </div>
      {canFill && field.agentFilled ? (
        <Button
          variant="outline"
          size="sm"
          disabled={left === 0}
          pending={fill.isPending}
          onClick={() => fill.mutate()}
        >
          {FILL}
        </Button>
      ) : null}
    </div>
  );
}
