import { deploymentTierFor } from "@/server/lib/deployment-tier";
import { getEnvValueSync, getWorkersEnv } from "@/server/lib/runtime-env";

/**
 * Whether this deployment bills its organizations' usage: the first-party
 * tier (deployment-tier.ts), as OpenSEO's first party on Every App does. A
 * fork pays its own providers and never bills. `everyapp dev` pins no
 * organization, so a local run derives first party too; it bills only with
 * BILLING=on in .dev.vars (against AUTUMN_DEV_STUB, or a test
 * AUTUMN_SECRET_KEY).
 */
export function billingEnabledFor(env: object): boolean {
  if (deploymentTierFor(env) !== "first_party") return false;
  if (!getEnvValueSync(env, "EVERYAPP_DEV")) return true;
  return getEnvValueSync(env, "BILLING") === "on";
}

export async function isBillingEnabled(): Promise<boolean> {
  return billingEnabledFor((await getWorkersEnv()) ?? {});
}
