import { AppError } from "@/server/lib/errors";
import { CreditReadingRepository } from "./creditReading";
import { billingEnabledFor, isBillingEnabled } from "./hosted";
import {
  checkUsageCreditsDepleted,
  getOrCreateOrganizationCustomer,
  type BillingCustomer,
} from "./subscription";

// The CRM's credit gates, in one place. On a deployment that bills, paid
// work starts only on OpenSEO's rule: any positive monthly plus top-up
// balance admits it, and only a confirmed ≤ 0 refuses (subscription.ts).
// Billing fails closed: with no Autumn key, or no balance reading, paid
// work doesn't start. A deployment that doesn't bill never asks.

// What the MCP tools say (the app shows its own copy).
const OUT_OF_CREDITS =
  "This organization doesn't have enough credits for this request. Retrying won't help until it has more credits: an owner can add them in Settings → Billing.";

/** Autumn's reading now, kept for the minute cron (creditReading.ts). */
async function readCredits(customer: BillingCustomer) {
  await getOrCreateOrganizationCustomer(customer);
  const reading = await checkUsageCreditsDepleted(customer);
  await CreditReadingRepository.note(customer.organizationId, reading.depleted);
  return reading;
}

/** A person's chat turn (SessionMeter.admit): Autumn's reading now. */
export function chatCredits(organizationId: string) {
  return readCredits({ organizationId });
}

/**
 * Work a person asks for (Enrich now, a team agent's run): refused with
 * INSUFFICIENT_CREDITS when the organization is out of credits.
 */
export async function requireCredits(customer: BillingCustomer): Promise<void> {
  if (!(await isBillingEnabled())) return;
  if ((await readCredits(customer)).depleted) {
    throw new AppError("INSUFFICIENT_CREDITS", OUT_OF_CREDITS);
  }
}

/**
 * Whether the organization may start paid background work now. Out of
 * credits lately says no without asking Autumn; otherwise Autumn is asked.
 * An Autumn failure admits nothing.
 */
export async function backgroundCredits(
  organizationId: string,
): Promise<boolean> {
  if (!(await isBillingEnabled())) return true;
  try {
    if (await CreditReadingRepository.held(organizationId)) return false;
    return !(await readCredits({ organizationId })).depleted;
  } catch (error) {
    console.error(
      "[billing] could not read credits; paid work waits",
      { organizationId },
      error,
    );
    return false;
  }
}

/**
 * Whether the organization's paid background work waits for credits now, as
 * the agent's screens say (AgentAvailabilityService): no Autumn call.
 */
export async function heldForCredits(organizationId: string) {
  if (!(await isBillingEnabled())) return false;
  return CreditReadingRepository.held(organizationId);
}

export type CreditCheck = (organizationId: string) => Promise<boolean>;

/**
 * The dispatcher lanes' check for one tick (or poke): backgroundCredits,
 * asked once per organization. Undefined where nothing is billed, and the
 * lanes then hold nothing for credits.
 */
export function laneCreditCheck(env: object): CreditCheck | undefined {
  return billingEnabledFor(env) ? creditCheckForTick() : undefined;
}

function creditCheckForTick(): CreditCheck {
  const asked = new Map<string, Promise<boolean>>();
  return (organizationId) => {
    let admitted = asked.get(organizationId);
    if (!admitted) {
      admitted = backgroundCredits(organizationId);
      asked.set(organizationId, admitted);
    }
    return admitted;
  };
}
