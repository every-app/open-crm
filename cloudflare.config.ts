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
  // Overrides the deployment shape (src/server/lib/deployment-tier.ts). Its
  // use is local: `DEPLOYMENT_TIER=fork` in .dev.vars shows a fork's setup
  // commands, since `everyapp dev` pins no organization.
  "DEPLOYMENT_TIER",
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
