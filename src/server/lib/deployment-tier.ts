/**
 * Who runs this deployment and for whom. Limits read this (as in OpenSEO),
 * never "is there a pinned organization" directly:
 *
 * - `first_party`: the CRM run by Every App for every organization on the
 *   platform, from one shared Worker and one Postgres database. The gateway
 *   holds the provider keys and meters them; the CRM bounds the research it
 *   pays for.
 * - `fork`: an organization's own copy, pinned to that organization
 *   (EVERY_APP_ORG_ID): a self-hosted gateway's CRM, or a fork on the hosted
 *   one. The operator pays for their own research.
 *
 * DEPLOYMENT_TIER overrides it; unset, a deployment pinned to one
 * organization is a fork and an unpinned one is first party.
 */
const DEPLOYMENT_TIERS = ["first_party", "fork"] as const;

type DeploymentTier = (typeof DEPLOYMENT_TIERS)[number];

const warnedInvalidTiers = new Set<string>();

function read(env: object, name: string): string | undefined {
  const processValue =
    typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (processValue) return processValue;
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** The tier for an env record (a Worker's env, or a Durable Object's). */
export function deploymentTierFor(env: object): DeploymentTier {
  const declared = read(env, "DEPLOYMENT_TIER");
  if (declared === "first_party" || declared === "fork") return declared;
  if (declared && !warnedInvalidTiers.has(declared)) {
    warnedInvalidTiers.add(declared);
    console.error(
      `Invalid DEPLOYMENT_TIER "${declared}"; deriving it from EVERY_APP_ORG_ID. Valid values: ${DEPLOYMENT_TIERS.join(", ")}.`,
    );
  }
  return read(env, "EVERY_APP_ORG_ID") ? "fork" : "first_party";
}

/**
 * Whether the minute cron starts the agent's scheduled research (the queue's
 * due rechecks, profiles and backfills). Work a person asked for (a chat, an
 * "enrich now") always runs.
 *
 * On in both tiers. Every session names the organization that owns it on each
 * gateway call (`x-everyapp-org`, server/lib/gateway-attribution.ts), so the
 * gateway attributes it per organization. FIRST_PARTY_SCHEDULED_RESEARCH=off
 * holds it in the first-party tier, the deployment that pays for every
 * organization's research at once.
 */
export function scheduledResearchEnabled(env: object): boolean {
  if (deploymentTierFor(env) !== "first_party") return true;
  return read(env, "FIRST_PARTY_SCHEDULED_RESEARCH") !== "off";
}

/** The label the logs and the agent's tools show for the tier. */
export function deploymentTierLabel(tier: DeploymentTier): string {
  switch (tier) {
    case "first_party":
      return "Every App (first party)";
    case "fork":
      return "Every App (fork)";
  }
}
