import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  STAGE_KINDS,
  type ListEntity,
  type StageKind,
} from "@/shared/crm-enums";
import { LIST_STAGES_MAX, STAGE_NAME_MAX } from "@/types/schemas/lists";

export type StageDraft = {
  key: string;
  id?: string;
  name: string;
  kind: StageKind;
  /** How many are at it: a stage can go only once nobody is. */
  count: number;
};

const KIND_LABELS: Record<StageKind, string> = {
  OPEN: "Open",
  DONE: "Done",
  DROPPED: "Dropped",
};

/**
 * A list's stages in the Edit list dialog: each renamed, given a kind and
 * moved up or down; one added; one removed, once nobody is at it.
 */
export function ListStagesField({
  entity,
  stages,
  onChange,
}: {
  entity: ListEntity;
  stages: StageDraft[];
  onChange: (stages: StageDraft[]) => void;
}) {
  const move = (index: number, by: -1 | 1) => {
    const next = [...stages];
    const [stage] = next.splice(index, 1);
    if (stage) next.splice(index + by, 0, stage);
    onChange(next);
  };
  const patch = (index: number, change: Partial<StageDraft>) =>
    onChange(
      stages.map((stage, at) =>
        at === index ? { ...stage, ...change } : stage,
      ),
    );
  const occupied = stages.filter((stage) => stage.count > 0);

  return (
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
              onChange={(event) => patch(index, { name: event.target.value })}
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
                className="w-24 sm:w-28"
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
              disabled={stage.count > 0}
              onClick={() => onChange(stages.filter((_, at) => at !== index))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ol>
      {occupied.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          A stage with {entity === "CONTACT" ? "people" : "companies"} in it
          can't be removed:{" "}
          {occupied.map((stage) => `${stage.name} (${stage.count})`).join(", ")}
          .
        </p>
      ) : null}
      {stages.length < LIST_STAGES_MAX ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...stages,
              { key: crypto.randomUUID(), name: "", kind: "OPEN", count: 0 },
            ])
          }
        >
          <Plus data-icon="inline-start" />
          Add stage
        </Button>
      ) : null}
    </fieldset>
  );
}
