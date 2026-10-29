// What the Worker reads beyond the bindings `cf workers types` infers from
// cloudflare.config.ts (.cloudflare/types/index.d.ts), all optional.

declare namespace Cloudflare {
  interface Env {
    // Set by `everyapp deploy`: the CRM is pinned to that organization. Unset
    // under `everyapp dev`.
    EVERY_APP_ORG_ID?: string;
    // The gateway's origin, for the sidebar's "Back to Every App".
    GATEWAY_URL?: string;
    // Set only while an operator erases an organization
    // (docs/maintainers/runbooks/erase-organization.md): signs its requests.
    ERASURE_SECRET?: string;
  }
}

interface ImportMetaEnv {
  readonly VITE_SHOW_DEVTOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
