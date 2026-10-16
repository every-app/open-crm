// How long a chat WebSocket stays open, as OpenSEO does behind an Every App
// gateway (samSocketLifetime.ts). The Worker authorizes a socket once, when it
// connects (agentRoutes.ts), and member rows only mirror the gateway, so a
// member the gateway removes would keep an open chat until it closed. Closing
// every socket this long after it connects bounds that: the client reconnects
// through the gateway, which signs a fresh identity, or refuses someone it no
// longer lets in.

export const SOCKET_LIFETIME_SECONDS = 15 * 60;

/** A normal close the agents client reconnects after (not a terminal 4xxx). */
const SOCKET_LIFETIME_CLOSE = {
  code: 1000,
  reason: "Reconnecting: chat sessions renew their sign-in every 15 minutes.",
} as const;

/** The scheduled close: a socket that has gone already needs nothing. */
export function closeExpiredSocket(
  connection: { close(code?: number, reason?: string): void } | undefined,
): void {
  if (!connection) return;
  try {
    connection.close(SOCKET_LIFETIME_CLOSE.code, SOCKET_LIFETIME_CLOSE.reason);
  } catch (error) {
    console.warn("[agent] closing an expired socket failed", error);
  }
}
