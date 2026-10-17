import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { workspace } from "@/db/schema";

// The organization's last confirmed "out of credits", kept on its workspace
// row as the model's refusal is (AgentAvailabilityRepository): the minute
// cron holds its paid background work for a while instead of asking Autumn
// for every task every minute, and the agent's screens say why it waits.
// Only depletion is kept. A positive reading never admits work: every start
// asks Autumn (credits.ts).

/** How long a confirmed "out of credits" holds background work. */
const CREDITS_RECHECK_MS = 5 * 60_000;

/** Readings taken since this hold the organization's background work now. */
export function creditsHeldSince(now = Date.now()): string {
  return new Date(now - CREDITS_RECHECK_MS).toISOString();
}

/** Whether Autumn confirmed the organization out of credits lately. */
async function held(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ depletedAt: workspace.creditsDepletedAt })
    .from(workspace)
    .where(eq(workspace.organizationId, organizationId));
  return Boolean(row?.depletedAt && row.depletedAt >= creditsHeldSince());
}

/** What Autumn just said: out of credits, or not. */
async function note(organizationId: string, depleted: boolean): Promise<void> {
  if (depleted) {
    await db
      .update(workspace)
      .set({ creditsDepletedAt: new Date().toISOString() })
      .where(eq(workspace.organizationId, organizationId));
    return;
  }
  await db
    .update(workspace)
    .set({ creditsDepletedAt: null })
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        isNotNull(workspace.creditsDepletedAt),
      ),
    );
}

export const CreditReadingRepository = { held, note };
