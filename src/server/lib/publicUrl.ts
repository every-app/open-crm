import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Whether the CRM may fetch a URL a model asked for (team agents' web_fetch).
// The Worker's global_fetch_strictly_public flag already keeps every fetch off
// private addresses; this refuses, before anything is fetched, what the flag
// lets through or can't be tested by:
//
// - anything but https, and a URL carrying credentials;
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

/** Why `url` may not be fetched for a model, or null when it may. */
export async function refusedUrl(url: URL): Promise<string | null> {
  if (url.protocol !== "https:") return "Only https:// pages can be read.";
  if (url.username || url.password) {
    return "A URL with credentials in it can't be read.";
  }
  return refusedHost(url);
}

/**
 * Why `url`'s host may not be fetched at all (an address, a local name, the
 * gateway's hosts), or null when it may. The agent's own reads of logos and
 * pages (fetchPublic) check every redirect with it.
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
