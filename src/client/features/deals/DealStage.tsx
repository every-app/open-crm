import { useState } from "react";
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
import type { DealStage } from "@/shared/crm-enums";
import {
  DEAL_STAGE_LABELS,
  DEAL_STAGE_ORDER,
  OPEN_DEAL_STAGES,
  isClosedStage,
  isLosingStage,
} from "@/shared/deal-stages";

// A deal's stage: how it reads, the menu that changes it, the reason a lost
// or unqualified deal asks for first, and the sheet's pipeline stepper.

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
            <form.SubmitButton form={FORM_ID}>Save</form.SubmitButton>
          </>
        }
      >
        <form.Form id={FORM_ID} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {count > 1
              ? "The same reason goes on every one of them, so keep it to what they have in common."
              : lost
                ? "What did we lose it to? This is the only place that answer gets recorded."
                : "Why is this not a fit? It goes on the timeline so nobody re-runs the same deal."}
          </p>
          <form.AppField name="reason">
            {(field) => (
              <field.TextareaField
                label="Reason"
                placeholder={
                  count > 1
                    ? "Budget pulled for the quarter"
                    : "Went with an incumbent vendor"
                }
                rows={3}
                autoFocus
              />
            )}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

/**
 * Changes a deal's stage from a menu of every stage; a lost or unqualified
 * deal asks why first. `control` is the sheet's button; `inline` sits in a
 * list row, whose click (it opens the deal) it keeps to itself.
 */
export function DealStageMenu({
  dealId,
  stage,
  variant = "inline",
}: {
  dealId: string;
  stage: DealStage;
  variant?: "inline" | "control";
}) {
  const [closing, setClosing] = useState<DealStage | null>(null);
  const setStage = useSetDealStage();
  const control = variant === "control";

  return (
    // Clicks in the menu and the dialog (portals) still bubble through React
    // to the row.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={setStage.isPending}
          render={
            control ? (
              <Button variant="outline" size="sm" />
            ) : (
              <button
                type="button"
                aria-label={`Stage: ${DEAL_STAGE_LABELS[stage]}. Change it`}
                className="flex min-w-0 items-center rounded-sm text-left hover:text-foreground disabled:opacity-50"
              />
            )
          }
        >
          <DealStageIndicator stage={stage} />
          {control ? <ChevronDown className="text-muted-foreground" /> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={control ? "end" : "start"}
          className="min-w-52"
        >
          <DropdownMenuRadioGroup
            value={stage}
            onValueChange={(next: unknown) => {
              const chosen = DEAL_STAGE_ORDER.find((option) => option === next);
              if (!chosen || chosen === stage) return;
              if (isLosingStage(chosen)) {
                setClosing(chosen);
                return;
              }
              setStage.mutate({ id: dealId, stage: chosen });
            }}
          >
            {DEAL_STAGE_ORDER.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {DEAL_STAGE_LABELS[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {closing ? (
        <CloseReasonDialog
          stage={closing}
          onClose={() => setClosing(null)}
          onSave={async (closedReason) => {
            await setStage.mutateAsync({
              id: dealId,
              stage: closing,
              closedReason,
            });
            toast.success("Deal closed.");
            setClosing(null);
          }}
        />
      ) : null}
    </span>
  );
}

// The open stages, then a win: the road a deal is meant to take.
const RAIL: DealStage[] = [...OPEN_DEAL_STAGES, "CLOSED_WON"];

/**
 * The pipeline as steps: click one to move the deal there. A deal lost or
 * unqualified shows where it left the road instead of a win.
 */
export function StageStepper({
  dealId,
  stage,
}: {
  dealId: string;
  stage: DealStage;
}) {
  const setStage = useSetDealStage((changed) => {
    if (changed) toast.success("Stage updated.");
  });
  const exited = isClosedStage(stage) && stage !== "CLOSED_WON";
  const steps = exited ? OPEN_DEAL_STAGES : RAIL;
  const currentIndex = steps.indexOf(stage);

  return (
    <ol className="flex w-full gap-1">
      {steps.map((option, index) => {
        const reached = !exited && index <= currentIndex;
        const current = !exited && option === stage;
        return (
          <li key={option} className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              disabled={setStage.isPending}
              onClick={() => {
                if (option !== stage) {
                  setStage.mutate({ id: dealId, stage: option });
                }
              }}
              className={cn(
                "min-w-0 flex-1 border-t-2 pt-2 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
                reached
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                current && "font-medium",
              )}
            >
              <span className="block truncate">
                {current && option === "CLOSED_WON" ? (
                  <DealStageIndicator stage={stage} />
                ) : (
                  DEAL_STAGE_LABELS[option]
                )}
              </span>
            </button>
          </li>
        );
      })}
      {exited ? (
        <li className="flex min-w-0 flex-1">
          <div className="min-w-0 flex-1 border-t-2 border-foreground pt-2 text-xs font-medium">
            <DealStageIndicator stage={stage} />
          </div>
        </li>
      ) : null}
    </ol>
  );
}
