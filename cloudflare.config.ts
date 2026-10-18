import { bindings, defineConfig } from "cf/config";
import { everyAppWorker } from "@every-app/sdk/cloudflare";
import * as entrypoint from "./src/server.ts" with { type: "cf-worker" };
import manifest from "./everyapp.config.ts";

// The CRM's Worker, as `pnpm dev`, `pnpm build` and `everyapp deploy` build
// it, from everyapp.config.ts. Nothing the Worker imports may be imported
// here: in dev the Cloudflare Vite plugin hides this file's imports from the
// Worker.

/** The CRM's own settings (`everyapp secret set`), all optional. */
const CRM_SECRETS = [
  // Raises GitHub's rate limit when the agent matches people to GitHub
  // profiles. Any classic token with no scopes will do.
  "GITHUB_TOKEN",
  // The OpenRouter model the agent runs on, for a self-hosted copy that
  // wants another than GPT-6 Luna (src/server/lib/openrouter.ts). The key
  // itself, OPENROUTER_API_KEY, is the gateway's.
  "OPENROUTER_MODEL",
  // Overrides the deployment shape (src/server/lib/deployment-tier.ts). Its
  // use is local: `DEPLOYMENT_TIER=fork` in .dev.vars shows a fork's setup
  // commands, since `everyapp dev` pins no organization.
  "DEPLOYMENT_TIER",
  // First party only: `off` holds the unattended work every organization's
  // agent would spend on (the enrichment sweep, scheduled research, team
  // agents' schedules and events) at once (src/server/lib/deployment-tier.ts).
  "FIRST_PARTY_SCHEDULED_RESEARCH",
  // First party only: Autumn, which bills the hosted CRM's usage on
  // OpenSEO's account (src/server/billing, docs/maintainers/billing.md).
  // This breaks "keys live in the gateway" on purpose, until the gateway's
  // wallet can bill for the apps; forks never set it.
  "AUTUMN_SECRET_KEY",
  // Local dev only, in .dev.vars: BILLING=on bills a local run as the first
  // party does, and AUTUMN_DEV_STUB=free|paid|low|out stands in for Autumn.
  "BILLING",
  "AUTUMN_DEV_STUB",
] as const;

export default defineConfig((ctx) => {
  const worker = everyAppWorker({
    manifest,
    entrypoint,
    ctx,
    // The research agent's dispatcher: leases due tasks every minute
    // (src/server/features/agent/dispatch.ts).
    crons: ["* * * * *"],
    secrets: CRM_SECRETS,
  });
  return {
    worker: {
      ...worker,
      compatibilityFlags: [
        ...worker.compatibilityFlags,
        "global_fetch_strictly_public",
      ],
      env: {
        ...worker.env,
        // Logos and photographs the agent copies so they outlive their
        // source, in a bucket named after the app's Worker.
        R2: bindings.r2({ name: worker.name }),
      },
    },
  };
});
