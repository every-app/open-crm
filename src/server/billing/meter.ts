import { OUT_OF_CREDITS_REPLY } from "@/shared/billing";
import { chatCredits } from "./credits";
import { isBillingEnabled } from "./hosted";
import { billResearchSpend } from "./researchSpend";
import type { ProviderSpend, SpendSink } from "./spendSink";
import { trackUsageCreditSpend, type UsageCredits } from "./subscription";

// A CrmAgent session's spend, metered as OpenSEO meters SAM's: each step's
// model cost (and a compaction summary's, and a Sonar search's) joins the
// session's unbilled total, which is billed once it reaches a chunk, and
// the remainder when the turn ends. Chunked rather than billed once per turn
// so a turn the Durable Object's memory limit kills mid-way still bills
// what it spent. Deductions run off the inference loop on one chain, so
// they land in order; the turn's end keeps the chain alive (waitUntil).
//
// Everything a turn spends is billed, past zero too (Autumn's overflow): a
// person's chat was admitted on a balance that covered what a turn may cost
// (credits.ts), and a research session or a team agent's run by the
// dispatcher, and either may cost more. Spend past zero is the
// organization's debt, and the next turn is refused until credits cover it.
// Context.dev calls bill each on its own, as background work, whatever the
// session.

// Batching threshold for metering, not a charge: the organization pays the
// turn's actual cost (times the markup) whatever this is.
const BILLING_CHUNK_USD = 0.05;

/** A turn the gate admitted, as its charges name it. */
type MeteredTurn = {
  organizationId: string;
  /** The session's kind, as the charges' `operation`. */
  operation: "chat" | "research" | "run";
  /** The session's id (and a run's id), on every charge. */
  properties: Record<string, string>;
  /**
   * A chat's credits at its gate, drawn down as it bills; null for
   * background work, which reads them for each charge (researchSpend.ts).
   */
  credits: UsageCredits | null;
};

export class SessionMeter {
  private unbilledUsd = 0;
  private turn: MeteredTurn | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly waitUntil: (promise: Promise<unknown>) => void,
  ) {}

  /**
   * Admits a turn and meters it, where usage is billed: null, or what the
   * turn says instead. A person's chat needs credits for a turn. A research
   * session or a team agent's run was admitted when the dispatcher started
   * it. The unbilled total carries over: a compaction summary between turns
   * is the same session's spend.
   */
  async admit(session: {
    kind: MeteredTurn["operation"];
    organizationId: string;
    sessionId: string;
  }): Promise<string | null> {
    this.turn = null;
    if (!(await isBillingEnabled())) return null;
    const { kind, organizationId, sessionId } = session;
    let credits: UsageCredits | null = null;
    if (kind === "chat") {
      const reading = await chatCredits(organizationId);
      if (!reading.enough) return OUT_OF_CREDITS_REPLY;
      credits = {
        monthlyRemaining: reading.monthlyRemaining,
        topupRemaining: reading.topupRemaining,
      };
    }
    this.turn = {
      organizationId,
      operation: kind,
      properties: { sessionId },
      credits,
    };
    return null;
  }

  /** Model spend, billed once a chunk has accumulated (or on `flush`). */
  record(costUsd: number, { flush = false } = {}): void {
    this.unbilledUsd += costUsd;
    const turn = this.turn;
    if (!turn) return;
    if (!flush && this.unbilledUsd < BILLING_CHUNK_USD) return;
    const chunkUsd = this.unbilledUsd;
    this.unbilledUsd = 0;
    if (chunkUsd <= 0) return;
    this.enqueue(() => this.bill(turn, chunkUsd));
  }

  /** Where the turn's tools report their paid calls (spendSink.ts). */
  readonly sink: SpendSink = (spend) => {
    if (spend.provider === "openrouter") {
      this.record(spend.costUsd);
      return;
    }
    const turn = this.turn;
    if (!turn) return;
    this.enqueue(() =>
      billResearchSpend(turn.organizationId, [spend], turn.properties),
    );
  };

  /** The turn ended: bill the remainder without holding the turn on it. */
  flush(): void {
    this.record(0, { flush: true });
    this.waitUntil(this.chain);
  }

  private enqueue(charge: () => Promise<void>): void {
    this.chain = this.chain.then(charge).catch((error: unknown) => {
      console.error("[agent] credit metering failed", error);
    });
  }

  private async bill(turn: MeteredTurn, costUsd: number): Promise<void> {
    const spend: ProviderSpend = {
      provider: "openrouter",
      creditFeature: "crm_agent",
      operation: turn.operation,
      costUsd,
    };
    if (!turn.credits) {
      await billResearchSpend(turn.organizationId, [spend], turn.properties);
      return;
    }
    const { monthlyCredits, topupCredits } = await trackUsageCreditSpend({
      organizationId: turn.organizationId,
      creditFeature: spend.creditFeature,
      costUsd,
      monthlyRemaining: turn.credits.monthlyRemaining,
      overdraft: { topupRemaining: turn.credits.topupRemaining },
      properties: {
        app: "open-crm",
        provider: spend.provider,
        operation: spend.operation,
        ...turn.properties,
      },
    });
    // Later chunks of the turn draw on what this one left.
    turn.credits.monthlyRemaining -= monthlyCredits;
    turn.credits.topupRemaining -= topupCredits;
  }
}
