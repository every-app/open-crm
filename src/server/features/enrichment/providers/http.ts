import { gatewayRefusal } from "@every-app/sdk/server";
import type { ProviderFetch } from "./gateway";

// One JSON POST to an enrichment provider. Answers are untrusted: the caller
// parses the body leniently.

export type Answer =
  | { ok: true; body: unknown; headers: Headers }
  | {
      ok: false;
      status: number;
      body: unknown;
      /** The gateway refused the call itself: the provider isn't set up for this install. */
      refused: boolean;
    };

const TIMEOUT_MS = 60_000;

export async function postJson(
  fetcher: ProviderFetch,
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, body: null, refused: false };
  }
  if (await gatewayRefusal(response)) {
    return { ok: false, status: response.status, body: null, refused: true };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok
    ? { ok: true, body: json, headers: response.headers }
    : { ok: false, status: response.status, body: json, refused: false };
}

/** Why a lookup failed, for the member, when the provider gave no better reason. */
export function failureReason(
  name: string,
  answer: Extract<Answer, { ok: false }>,
): string {
  if (answer.refused) {
    return `${name} isn't set up on this Every App gateway.`;
  }
  if (answer.status === 401 || answer.status === 403) {
    return `${name} refused the key the gateway holds.`;
  }
  if (answer.status === 429) {
    return `${name} is limiting requests. Try again in a moment.`;
  }
  if (answer.status === 0) return `${name} did not answer in time.`;
  return `${name} could not complete the lookup (${answer.status}).`;
}
