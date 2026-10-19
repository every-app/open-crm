import {
  ADDRESS_REQUESTS_PER_MINUTE,
  ADDRESS_SITE_REQUESTS_PER_MINUTE,
} from "@/server/features/tracking/trackingRules";

// The public routes' first guard, before anything reads the database: how
// many requests one address may make a minute, to one site and in all.
// Every App's deploy policy refuses Workers Rate Limiting bindings (the
// CLI's ALLOWED_BINDINGS), so this counts in the isolate's memory. It stops
// one address hammering a site, not a crowd spread over Cloudflare's
// machines; the counters in the database (per site and visitor a minute,
// per organization a day) bound that.

/** Keys one minute may count; past it, new ones wait for the next minute. */
const MAX_KEYS = 10_000;

let minute = 0;
let counts = new Map<string, number>();

/**
 * Who a request counts against: its IPv4 address, or its IPv6 address's
 * /64, which one client holds whole. Cloudflare sets CF-Connecting-IP and
 * the gateway passes it on.
 */
export function addressOf(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip")?.trim().toLowerCase();
  if (!ip?.includes(":")) return ip ?? "";
  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = Math.max(8 - left.length - right.length, 0);
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(zeros).fill("0"), ...right];
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** Counts one request from `address` to `siteId`: false past either limit. */
export function withinAddressLimit(address: string, siteId: string): boolean {
  const current = Math.floor(Date.now() / 60_000);
  if (current !== minute) {
    minute = current;
    counts = new Map();
  }
  return (
    take(address, ADDRESS_REQUESTS_PER_MINUTE) &&
    take(`${address} ${siteId}`, ADDRESS_SITE_REQUESTS_PER_MINUTE)
  );
}

function take(key: string, limit: number): boolean {
  const count = counts.get(key) ?? 0;
  if (count >= limit || (count === 0 && counts.size >= MAX_KEYS)) return false;
  counts.set(key, count + 1);
  return true;
}
