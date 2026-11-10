import {
  UserMessageError,
  isErrorCode,
  type ErrorCode,
} from "@/shared/error-codes";

/** Copy for an error we did not expect. */
const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Try again in a moment.";

// INTERNAL_ERROR has no copy of its own: like any error we did not expect, it
// shows the caller's fallback.
const STANDARD_MESSAGES: Record<
  Exclude<ErrorCode, "INTERNAL_ERROR">,
  string
> = {
  UNAUTHENTICATED: "Sign in on Every App and try again.",
  AUTH_CONFIG_MISSING:
    "The CRM isn't set up on your Every App gateway yet. Deploy it with `everyapp deploy`.",
  FORBIDDEN: "Only an owner or an admin can do that.",
  NOT_FOUND: "This no longer exists.",
  VALIDATION_ERROR: "Check your input and try again.",
  CONFLICT: "This conflicts with an existing record.",
  RATE_LIMITED: "Too many requests. Try again in a moment.",
  UPSTREAM_UNAVAILABLE: "A provider is unavailable. Try again in a moment.",
  INTEGRATION_UNAVAILABLE:
    "That connection isn't set up on this Every App gateway yet. An admin sets it up there.",
};

/**
 * What to tell the person: the server's own words when it wrote them for
 * people, else its code's copy. Any other error (the network failing, a bug
 * in the browser) shows `fallback`: its message was never written for them.
 */
export function getStandardErrorMessage(
  error: unknown,
  fallback: string = UNEXPECTED_ERROR_MESSAGE,
): string {
  if (error instanceof UserMessageError) return error.userMessage;
  const code = getErrorCode(error);
  return code && code !== "INTERNAL_ERROR" ? STANDARD_MESSAGES[code] : fallback;
}

export function getErrorCode(error: unknown): ErrorCode | null {
  if (!(error instanceof Error)) return null;
  return isErrorCode(error.message) ? error.message : null;
}

// Asking again gets the same answer.
const FINAL_ERROR_CODES = new Set<ErrorCode>([
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
]);

/** Whether trying again could go differently: not for a record that is gone, or a refusal. */
export function isRetryableError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === null || !FINAL_ERROR_CODES.has(code);
}
