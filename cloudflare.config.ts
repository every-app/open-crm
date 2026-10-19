import { bindings, defineConfig } from "cf/config";
import { everyAppWorker } from "@every-app/sdk/cloudflare";
import * as entrypoint from "./src/server.ts" with { type: "cf-worker" };
import manifest from "./everyapp.config.ts";

// The CRM's Worker, as `pnpm dev`, `pnpm build:dev` and `everyapp deploy` build
// it, from everyapp.config.ts. Nothing the Worker imports may be imported
// here: in dev the Cloudflare Vite plugin hides this file's imports from the
// Worker.

export default defineConfig((ctx) => {
  const worker = everyAppWorker({
    manifest,
    entrypoint,
    ctx,
    // The research agent's dispatcher: leases due tasks every minute
    // (src/server/features/agent/dispatch.ts).
    crons: ["* * * * *"],
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
