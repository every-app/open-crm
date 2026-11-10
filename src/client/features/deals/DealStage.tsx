import { revalidateLogic } from "@tanstack/react-form";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "cn";
import { FormDialog } from "@/client/components/FormDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useSetDealStage } from "@/client/features/deals/useDealMutations";
import {
  useAppSearch,
  useSetAppSearch,
} from "@/client/features/records/recordStack";
import type { DealStage } from "@/shared/crm-enums";
import {
  CLOSED_DEAL_STAGES,
  DEAL_STAGE_LABELS,
  DEAL_STAGE_ORDER,
  OPEN_DEAL_STAGES,
  isClosedStage,
  isLosingStage,
} from "@/shared/deal-stages";

// A deal's stage: how it reads, the menu that changes it in a list row, the
// reason a lost or unqualified deal asks for first (in the URL while it's
// asked: `closeDeal` and `closeStage`), and the sheet's pipeline stepper.

type Tone = "neutral" | "info" | "warning" | "success" | "error";

const TONES: Record<DealStage, Tone> = {
  DEMO_BOOKED: "neutral",
  QUALIFIED_TO_BUY: "info",
  DECISION_MAKER_BOUGHT_IN: "info",
  CONTRACT_SENT: "warning",
  CLOSED_WON: "success",
  CLOSED_LOST: "error",
  UNQUALIFIED_TO_BUY: "neutral",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  error: "bg-destructive",
};

/** A stage as a coloured dot and its name. */
export function DealStageIndicator({
  stage,
  className,
}: {
  stage: DealStage;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT[TONES[stage]])}
      />
      <span className="truncate">{DEAL_STAGE_LABELS[stage]}</span>
    </span>
  );
}

const FORM_ID = "close-deal-reason";

const reasonSchema = z.object({
  reason: z.string().trim().min(1, "Say why, in a few words.").max(2000),
});

/**
 * Asks why before a deal (or `count` of them) is closed as lost or marked
 * unqualified: the reason goes on its timeline. `onSave` closes it.
 */
export function CloseReasonDialog({
  stage,
  count = 1,
  onSave,
  onClose,
}: {
  stage: DealStage;
  count?: number;
  onSave: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const form = useAppForm({
    defaultValues: { reason: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: reasonSchema },
    onSubmit: async ({ value }) => {
      await onSave(value.reason.trim());
    },
  });
  const lost = stage === "CLOSED_LOST";
  const deals = count === 1 ? "" : ` ${count} deals`;
  return (
    <form.AppForm>
      <FormDialog
        title={lost ? `Close${deals} as lost` : `Mark${deals} as unqualified`}
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={FORM_ID}>
              {lost ? "Close as lost" : "Mark as unqualified"}
            </form.SubmitButton>
          </>
        }
      >
        <form.Form id={FORM_ID} className="flex flex-col gap-4">
          <form.AppField name="reason">
            {(field) => (
              <field.TextareaField label="Reason" rows={3} autoFocus />
            )}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

/**
 * The reason a deal closing as lost or unqualified asks for, while the URL
 * names the deal and the stage. RecordSheetHost renders it.
 */
export function CloseReasonHost() {
  const { closeDeal, closeStage } = useAppSearch();
  const setSearch = useSetAppSearch();
  const setStage = useSetDealStage();
  if (!closeDeal || !closeStage) return null;
  const close = () =>
    setSearch({ closeDeal: undefined, closeStage: undefined });
  return (
    <CloseReasonDialog
      key={`${closeDeal}:${closeStage}`}
      stage={closeStage}
      onClose={close}
      onSave={async (closedReason) => {
        await setStage.mutateAsync({
          id: closeDeal,
          stage: closeStage,
          closedReason,
        });
        toast.success("Deal closed.");
        close();
      }}
    />
  );
}

/**
 * Moves a deal to another stage. A lost or unqualified deal asks why first
 * (CloseReasonHost).
 */
function useMoveStage(
  dealId: string,
  stage: DealStage,
  onMoved?: (changed: boolean) => void,
) {
  const setSearch = useSetAppSearch();
  const setStage = useSetDealStage(onMoved);
  return {
    pending: setStage.isPending,
    move: (next: DealStage) => {
      if (next === stage) return;
      if (isLosingStage(next)) {
        setSearch({ closeDeal: dealId, closeStage: next });
      } else {
        setStage.mutate({ id: dealId, stage: next });
      }
    },
  };
}

/** A stage menu's choices, the deal's own stage checked. */
function StageOptions({
  stages,
  stage,
  onPick,
}: {
  stages: readonly DealStage[];
  stage: DealStage;
  onPick: (stage: DealStage) => void;
}) {
  return (
    <DropdownMenuRadioGroup
      value={stage}
      onValueChange={(next: unknown) => {
        const chosen = stages.find((option) => option === next);
        if (chosen) onPick(chosen);
      }}
    >
      {stages.map((option) => (
        // A pick is the whole interaction: the menu closes on it.
        <DropdownMenuRadioItem key={option} value={option} closeOnClick>
          {DEAL_STAGE_LABELS[option]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/**
 * A deal's stage in a list row, changed from a menu of every stage. The
 * row's click (it opens the deal) it keeps to itself.
 */
export function DealStageMenu({
  dealId,
  stage,
}: {
  dealId: string;
  stage: DealStage;
}) {
  const { pending, move } = useMoveStage(dealId, stage);
  return (
    // Clicks in the menu (a portal) still bubble through React to the row.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          render={
            <button
              type="button"
              aria-label={`Stage: ${DEAL_STAGE_LABELS[stage]}. Change it`}
              className="flex min-w-0 items-center rounded-sm text-left hover:text-foreground disabled:opacity-50"
            />
          }
        >
          <DealStageIndicator stage={stage} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <StageOptions stages={DEAL_STAGE_ORDER} stage={stage} onPick={move} />
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

const STEP =
  "min-w-0 flex-1 border-t-2 pt-2 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-50";
const REACHED = "border-foreground text-foreground";
const AHEAD =
  "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground";

/**
 * A deal's stage on its sheet, the one place it changes there: the pipeline
 * as steps (click one to move the deal to it), then how it ends. The last
 * step is a menu of the outcomes: won, or lost or unqualified, which ask
 * why first.
 */
export function StageStepper({
  dealId,
  stage,
}: {
  dealId: string;
  stage: DealStage;
}) {
  const { pending, move } = useMoveStage(dealId, stage, (changed) => {
    if (changed) toast.success("Stage updated.");
  });
  const closed = isClosedStage(stage);
  const currentIndex = OPEN_DEAL_STAGES.indexOf(stage);

  return (
    <ol className="flex w-full gap-1">
      {OPEN_DEAL_STAGES.map((option, index) => {
        // A won deal went the whole road; a lost or unqualified one left it.
        const reached =
          stage === "CLOSED_WON" || (!closed && index <= currentIndex);
        return (
          <li key={option} className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-current={option === stage ? "step" : undefined}
              disabled={pending}
              onClick={() => move(option)}
              className={cn(
                STEP,
                reached ? REACHED : AHEAD,
                option === stage && "font-medium",
              )}
            >
              {DEAL_STAGE_LABELS[option]}
            </button>
          </li>
        );
      })}
      {/* As wide as the others, but never too narrow for its outcome. */}
      <li className="flex min-w-fit flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            render={
              <button
                type="button"
                aria-current={closed ? "step" : undefined}
                className={cn(
                  STEP,
                  "flex items-start gap-1",
                  closed ? cn(REACHED, "font-medium") : AHEAD,
                )}
              />
            }
          >
            {closed ? <DealStageIndicator stage={stage} /> : "Close deal"}
            <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <StageOptions
              stages={CLOSED_DEAL_STAGES}
              stage={stage}
              onPick={move}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </ol>
  );
}
