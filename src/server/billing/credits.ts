import { AppError } from "@/server/lib/errors";
import { CreditReadingRepository } from "./creditReading";
import { AGENT_MINIMUM_CREDITS } from "./estimates";
import { billingEnabledFor, isBillingEnabled } from "./hosted";
import {
  checkUsageCredits,
  getOrCreateOrganizationCustomer,
  totalCredits,
  type BillingCustomer,
  type UsageCredits,
} from "./subscription";

// The CRM's credit gates, in one place. On a deployment that bills, the
// agent starts paid work only while the organization's monthly plus top-up
// balance covers what a chat turn may cost (AGENT_MINIMUM_CREDITS,
// estimates.ts); below it the organization is out of credits for the agent.
// Background work is then admitted task by task against the balance the
// minute's tick read (laneCreditCheck). Billing fails closed: with no Autumn
// key, or no balance reading, paid work doesn't start. A deployment that
// doesn't bill never asks.

// What the MCP tools say (the app shows its own copy).
const OUT_OF_CREDITS =
  "This organization doesn't have enough credits for this request. Retrying won't help until it has more credits: an owner can add them in Settings → Billing.";

type CreditReading = UsageCredits & {
  /** Monthly plus top-up credits. */
  remaining: number;
  /** Whether they cover what a chat turn may cost. */
  enough: boolean;
};

/** Autumn's reading now, kept for the minute cron (creditReading.ts). */
async function readCredits(customer: BillingCustomer): Promise<CreditReading> {
  await getOrCreateOrganizationCustomer(customer);
  const credits = await checkUsageCredits(customer, AGENT_MINIMUM_CREDITS);
  const remaining = totalCredits(credits);
  const enough = remaining >= AGENT_MINIMUM_CREDITS;
  await CreditReadingRepository.note(customer.organizationId, !enough);
  return { ...credits, remaining, enough };
}

/** A person's chat turn (SessionMeter.admit): Autumn's reading now. */
export function chatCredits(organizationId: string) {
  return readCredits({ organizationId });
}

/**
 * Work a person asks for (Enrich now, a team agent's run): refused with
 * INSUFFICIENT_CREDITS while the organization is out of credits.
 */
export async function requireCredits(customer: BillingCustomer): Promise<void> {
  if (!(await isBillingEnabled())) return;
  if (!(await readCredits(customer)).enough) {
    throw new AppError("INSUFFICIENT_CREDITS", OUT_OF_CREDITS);
  }
}

/**
 * The credits the organization has for paid background work now: none while
 * it is out of credits, lately or now. Out of credits lately says so without
 * asking Autumn; an Autumn failure admits nothing.
 */
async function backgroundBalance(organizationId: string): Promise<number> {
  try {
    if (await CreditReadingRepository.held(organizationId)) return 0;
    const reading = await readCredits({ organizationId });
    return reading.enough ? reading.remaining : 0;
  } catch (error) {
    console.error(
      "[billing] could not read credits; paid work waits",
      { organizationId },
      error,
    );
    return 0;
  }
}

/** Whether the organization may start paid background work now. */
export async function backgroundCredits(
  organizationId: string,
): Promise<boolean> {
  if (!(await isBillingEnabled())) return true;
  return (await backgroundBalance(organizationId)) > 0;
}

/**
 * Whether the organization's paid background work waits for credits now, as
 * the agent's screens say (AgentAvailabilityService): no Autumn call.
 */
export async function heldForCredits(organizationId: string) {
  if (!(await isBillingEnabled())) return false;
  return CreditReadingRepository.held(organizationId);
}

/**
 * A dispatcher lane's credit check. Asked with a piece of work's estimate
 * (estimates.ts), it admits the work when the estimate fits what the
 * organization's balance has left this tick, and takes it off; asked
 * without one, it says whether the organization has credits at all.
 */
export type CreditCheck = (
  organizationId: string,
  estimate?: number,
) => Promise<boolean>;

/**
 * The lanes' check for one tick (or poke), which reads each organization's
 * balance once. Undefined where nothing is billed, and the lanes then hold
 * nothing for credits.
 */
export function laneCreditCheck(env: object): CreditCheck | undefined {
  return billingEnabledFor(env) ? creditCheckForTick() : undefined;
}

function creditCheckForTick(): CreditCheck {
  const balances = new Map<string, Promise<{ read: number; left: number }>>();
  return async (organizationId, estimate) => {
    let pending = balances.get(organizationId);
    if (!pending) {
      pending = backgroundBalance(organizationId).then((read) => ({
        read,
        left: read,
      }));
      balances.set(organizationId, pending);
    }
    const balance = await pending;
    if (estimate === undefined) return balance.read > 0;
    // Work that doesn't fit waits for a later tick; cheaper work behind it
    // may still fit.
    if (balance.left <= 0 || estimate > balance.left) return false;
    balance.left -= estimate;
    return true;
  };
}
