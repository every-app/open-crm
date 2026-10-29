import type { DealStage } from "@/shared/crm-enums";

// What a deal's stage means: where it sits in the pipeline, whether the deal
// is still open, and what people call it. The deals feature owns it;
// companies count and order a company's deals by it.

/** Every stage in pipeline order: the open ones, then the outcomes. */
export const DEAL_STAGE_ORDER = [
  "DEMO_BOOKED",
  "QUALIFIED_TO_BUY",
  "DECISION_MAKER_BOUGHT_IN",
  "CONTRACT_SENT",
  "CLOSED_WON",
  "CLOSED_LOST",
  "UNQUALIFIED_TO_BUY",
] as const satisfies readonly DealStage[];

/** The pipeline: stages a deal is still being worked in. */
export const OPEN_DEAL_STAGES: DealStage[] = [
  "DEMO_BOOKED",
  "QUALIFIED_TO_BUY",
  "DECISION_MAKER_BOUGHT_IN",
  "CONTRACT_SENT",
];

/** Outcomes: a deal moved into one is closed, and when is recorded. */
export const CLOSED_DEAL_STAGES: DealStage[] = [
  "CLOSED_WON",
  "CLOSED_LOST",
  "UNQUALIFIED_TO_BUY",
];

/**
 * Outcomes that take a reason: a lost deal with no reason teaches nobody
 * anything.
 */
const LOSING_DEAL_STAGES: DealStage[] = ["CLOSED_LOST", "UNQUALIFIED_TO_BUY"];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  DEMO_BOOKED: "Demo booked",
  QUALIFIED_TO_BUY: "Qualified to buy",
  DECISION_MAKER_BOUGHT_IN: "Decision maker in",
  CONTRACT_SENT: "Contract sent",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
  UNQUALIFIED_TO_BUY: "Unqualified",
};

export function isClosedStage(stage: DealStage): boolean {
  return CLOSED_DEAL_STAGES.includes(stage);
}

export function isLosingStage(stage: DealStage): boolean {
  return LOSING_DEAL_STAGES.includes(stage);
}
