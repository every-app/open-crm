import type { z } from "zod";

// The one place a Gmail, Calendar or Graph answer becomes an outcome, ported
// from the CRM's mailbox-api.client.ts: a bearer GET with a timeout, its
// status read as "the cursor expired", "the token was refused", "slow down"
// or a failure. Calls are made with the member's own access token, straight
// to the provider; the gateway only ever sees the token endpoint.

export type MailboxResult<T> =
  | { outcome: "ok"; data: T }
  | { outcome: "cursor-invalid"; reason: string }
  | { outcome: "unauthorized"; reason: string }
  | { outcome: "rate-limited"; reason: string; retryAfterMs: number }
  | { outcome: "failed"; reason: string };

export type MailboxFailure = Exclude<MailboxResult<unknown>, { outcome: "ok" }>;

/**
 * What one check may still spend: provider calls (each a Worker subrequest)
 * and time. Shared by every mailbox one cron tick runs, so one big mailbox
 * can't use up a tick another was due in.
 */
export type CallBudget = { calls: number; deadline: number };

export function budgetLeft(budget: CallBudget): boolean {
  return budget.calls > 0 && Date.now() < budget.deadline;
}

const TIMEOUT_MS = 15_000;
const MIN_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export async function mailboxGet<T>(
  url: string,
  accessToken: string,
  schema: z.ZodType<T>,
  budget: CallBudget,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<MailboxResult<T>> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) target.searchParams.set(key, String(value));
  }
  budget.calls -= 1;
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      outcome: "failed",
      reason: timedOut
        ? `${target.host} did not answer within ${TIMEOUT_MS / 1000} seconds.`
        : `${target.host} could not be reached.`,
    };
  }

  if (response.ok) {
    const parsed = schema.safeParse(await response.json().catch(() => null));
    return parsed.success
      ? { outcome: "ok", data: parsed.data }
      : {
          outcome: "failed",
          reason: `${target.host} answered in a shape the CRM doesn't read.`,
        };
  }

  const detail = await reasonOf(response);
  switch (response.status) {
    case 401:
      return { outcome: "unauthorized", reason: detail };
    case 404:
    case 410:
      return { outcome: "cursor-invalid", reason: detail };
    case 403:
      if (/rate|quota|userRateLimitExceeded|limitExceeded/i.test(detail)) {
        return {
          outcome: "rate-limited",
          reason: detail,
          retryAfterMs: backoffFrom(response),
        };
      }
      return { outcome: "failed", reason: detail };
    case 429:
      return {
        outcome: "rate-limited",
        reason: detail,
        retryAfterMs: backoffFrom(response),
      };
    default:
      console.warn("[mailbox] provider call failed", {
        host: target.host,
        path: target.pathname,
        status: response.status,
      });
      return { outcome: "failed", reason: detail };
  }
}

function backoffFrom(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  const suggested = Number.isFinite(seconds) ? seconds * 1000 : MIN_BACKOFF_MS;
  return Math.min(Math.max(suggested, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
}

/** Google's and Graph's `{ error: { message } }`, or the status. */
async function reasonOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body) {
    const error: unknown = body.error;
    if (error && typeof error === "object") {
      for (const key of ["message", "status", "code"]) {
        const value: unknown = Reflect.get(error, key);
        if (typeof value === "string" && value) return value;
      }
    }
  }
  return `HTTP ${response.status}`;
}
