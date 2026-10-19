import { chatCredits } from "./credits";
import { isBillingEnabled } from "./hosted";
import { billResearchSpend } from "./researchSpend";
import type { ProviderSpend, SpendSink } from "./spendSink";
import { trackUsageCreditSpend } from "./subscription";

// A CrmAgent session's spend, metered as OpenSEO meters SAM's: each step's
// model cost (and a compaction summary's, and a Sonar search's) joins the
// session's unbilled total, which is billed once it reaches a chunk, and
// the remainder when the turn ends. Chunked rather than billed once per turn
// so a turn the Durable Object's memory limit kills mid-way still bills
// what it spent. Deductions run off the inference loop on one chain, so
// they land in order; the turn's end keeps the chain alive (waitUntil).
//
// A person's chat bills as SAM's chats do, without overdraft (Autumn stops
// at zero). A research session or a team agent's run was admitted by the
// dispatcher and bills as OpenSEO's background research does: overdraft,
// never throwing. Context.dev calls bill each on its own, as background
// work, whatever the session.

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
  /** A chat's balance at its gate; null bills with overdraft. */
  monthlyRemaining: number | null;
};

export class SessionMeter {
  private unbilledUsd = 0;
  private turn: MeteredTurn | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly waitUntil: (promise: Promise<unknown>) => void,
  ) {}

  /**
   * Admits a turn and meters it, where usage is billed. A person's chat is
   * gated on the organization's credits now: true when it is out, and the
   * turn is refused. A research session or a team agent's run was admitted
   * when the dispatcher started it, so it is metered with overdraft. The
   * unbilled total carries over: a compaction summary between turns is the
   * same session's spend.
   */
  async admit(session: {
    kind: MeteredTurn["operation"];
    organizationId: string;
    sessionId: string;
  }): Promise<boolean> {
    this.turn = null;
    if (!(await isBillingEnabled())) return false;
    const { kind, organizationId, sessionId } = session;
    let monthlyRemaining: number | null = null;
    if (kind === "chat") {
      const reading = await chatCredits(organizationId);
      if (!reading.enough) return true;
      monthlyRemaining = reading.monthlyRemaining;
    }
    this.turn = {
      organizationId,
      operation: kind,
      properties: { sessionId },
      monthlyRemaining,
    };
    return false;
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
    if (turn.monthlyRemaining === null) {
      await billResearchSpend(turn.organizationId, [spend], turn.properties);
      return;
    }
    const { monthlyCredits } = await trackUsageCreditSpend({
      organizationId: turn.organizationId,
      creditFeature: spend.creditFeature,
      costUsd,
      monthlyRemaining: turn.monthlyRemaining,
      properties: {
        app: "open-crm",
        provider: spend.provider,
        operation: spend.operation,
        ...turn.properties,
      },
    });
    // Later chunks of the turn draw on what this one left.
    turn.monthlyRemaining -= monthlyCredits;
  }
}
