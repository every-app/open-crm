import { BackButton } from "@/client/components/PageHeader";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { SHEET_TITLE } from "@/client/features/fields/fieldsCopy";
import type { Field } from "@/server/features/fields/services/fieldShape";
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

/** How much of the field is filled. */
export function Coverage({
  field,
  coverage,
}: {
  field: Field;
  coverage: FieldCoverage;
}) {
  const noun = ENTITY_NOUNS[field.entity];
  const left = coverage.total - coverage.filled;
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-sm font-medium">
        Filled on {coverage.filled} of {coverage.total} {noun.many}
      </p>
      <p className="text-xs text-muted-foreground">
        {left > 0 ? `${left} still to go` : "Filled on every one"}
      </p>
    </div>
  );
}
