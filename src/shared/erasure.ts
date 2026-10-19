// Erasing one organization: the operator's script
// (scripts/erase-organization.ts) asks the CRM's Worker, which holds the
// database, the agents' Durable Objects, the R2 bucket and the tokens, to
// list or erase it (src/server/features/erasure). Each request is signed
// with ERASURE_SECRET over its timestamp and body, as OpenSEO signs its GDPR
// erasure. The script runs this file as is under Node, so it imports
// nothing.

export const ERASURE_PATH = "/internal/erase-organization";

/** An inventory (the dry run), or the next bounded step of the erasure. */
export type ErasureRequest =
  | { organizationId: string; step: "inventory" }
  | { organizationId: string; step: "erase"; confirm: string };

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC SHA-256 of `<timestamp>.<body>`, in hex. */
export async function signErasureRequest(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${body}`),
    ),
  );
}
