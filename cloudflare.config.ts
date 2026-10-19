import { bindings, defineConfig } from "cf/config";
import { everyAppWorker } from "@every-app/sdk/cloudflare";
import * as entrypoint from "./src/server.ts" with { type: "cf-worker" };
import manifest from "./everyapp.config.ts";

// The CRM's Worker, as `pnpm dev`, `pnpm build:dev` and `everyapp deploy` build
// it, from everyapp.config.ts. Nothing the Worker imports may be imported
// here: in dev the Cloudflare Vite plugin hides this file's imports from the
// Worker.

/** The CRM's own settings (`everyapp secret set`), all optional but one. */
const CRM_SECRETS = [
  // Required before anyone connects mail, a calendar or Slack: the key their
  // tokens are encrypted under, 32 or more random characters
  // (src/server/lib/tokenCrypto.ts). Changing it means connecting again.
  "TOKEN_ENCRYPTION_KEY",
  // Raises GitHub's rate limit when the agent matches people to GitHub
  // profiles. Any classic token with no scopes will do.
  "GITHUB_TOKEN",
  // The OpenRouter model the agent runs on, for a deployment that wants
  // another than GPT-6 Luna (src/server/lib/openrouter.ts). The key itself,
  // OPENROUTER_API_KEY, is the gateway's.
  "OPENROUTER_MODEL",
  // Set only while an operator erases an organization: it signs the erasure
  // requests (docs/maintainers/runbooks/erase-organization.md).
  "ERASURE_SECRET",
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
