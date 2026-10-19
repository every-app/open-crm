// What the Worker reads beyond the bindings `cf workers types` infers from
// cloudflare.config.ts (.cloudflare/types/index.d.ts), all optional.

declare namespace Cloudflare {
  interface Env {
    // Set by `everyapp deploy` for a fork: the CRM is pinned to that
    // organization. Unset on a first-party deployment, where the organization
    // comes from each request's identity.
    EVERY_APP_ORG_ID?: string;
    // The gateway's origin, for the account menu's "Sign out on Every App".
    GATEWAY_URL?: string;
    // first_party or fork (src/server/lib/deployment-tier.ts), derived from
    // EVERY_APP_ORG_ID when unset.
    DEPLOYMENT_TIER?: string;
    // "off" holds a first-party deployment's scheduled research.
    FIRST_PARTY_SCHEDULED_RESEARCH?: string;
    // The first-party shape's database (everyapp.config.ts): "postgres" with a
    // HYPERDRIVE binding; D1 otherwise.
    DATABASE_PROVIDER?: "d1" | "postgres";
    HYPERDRIVE?: {
      connectionString: string;
    };
    // Optional app secret (`everyapp secret set GITHUB_TOKEN`): raises GitHub's
    // rate limit for the agent's profile matching.
    GITHUB_TOKEN?: string;
    // Set only while an operator erases an organization
    // (docs/maintainers/runbooks/erase-organization.md): signs its requests.
    ERASURE_SECRET?: string;
    // Local dev only, in .dev.vars: with no gateway binding the SDK calls the
    // providers with these.
    OPENROUTER_API_KEY?: string;
    CONTEXT_API_KEY?: string;
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
