import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Whether the CRM may fetch a host (website tracking's installation check).
// The Worker's global_fetch_strictly_public flag only sends a fetch to the
// Worker's own zone through Cloudflare's front door, not straight to its
// origin; it checks no address, and nothing here resolves a name. This
// refuses, before anything is fetched:
//
// - an IP address for a host (a page is fetched by its name, and https to an
//   address can't show a certificate for it), localhost, and a name with no
//   dot;
// - the Every App gateway's host and the app hosts under it, this CRM's
//   among them. Strictly public routes those through Cloudflare's front
//   door, which is the gateway itself; the gateway refuses its own domains
//   for the same reason (private-every-app docs/security-model.md).

// The gateway's origin: GATEWAY_URL where the deploy sets it, and the
// identity issuer, which is the same origin (src/serverFunctions/everyApp.ts).
const GATEWAY_ORIGINS = ["GATEWAY_URL", "EVERYAPP_IDENTITY_ISSUER"] as const;

async function gatewayHosts(): Promise<string[]> {
  const hosts: string[] = [];
  for (const name of GATEWAY_ORIGINS) {
    const value = await getOptionalEnvValue(name);
    if (!value) continue;
    try {
      hosts.push(new URL(value).hostname.toLowerCase());
    } catch {
      // Not a URL: nothing to refuse by it.
    }
  }
  return hosts;
}

/**
 * Why `url`'s host may not be fetched at all (an address, a local name, the
 * gateway's hosts), or null when it may.
 */
export async function refusedHost(url: URL): Promise<string | null> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // The URL parser writes every IPv4 form as a dotted quad and IPv6 in
  // brackets.
  const address = host.startsWith("[") || /^[\d.]+$/.test(host);
  if (
    address ||
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost")
  ) {
    return "That is not a public web address.";
  }
  for (const gateway of await gatewayHosts()) {
    if (host === gateway || host.endsWith(`.${gateway}`)) {
      return "That address is on the Every App gateway.";
    }
  }
  return null;
}
