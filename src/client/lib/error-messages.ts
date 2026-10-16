import { isErrorCode, type ErrorCode } from "@/shared/error-codes";

/** Copy for an error we did not expect. */
export const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong. Please try again, or check the server logs for details.";

const STANDARD_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in on Every App and try again.",
  AUTH_CONFIG_MISSING:
    "The CRM isn't set up on your Every App gateway yet. Deploy it with `everyapp deploy`.",
  FORBIDDEN: "Only an owner or an admin can do that.",
  NOT_FOUND: "The requested record was not found.",
  VALIDATION_ERROR: "Please check your input and try again.",
  CONFLICT: "This conflicts with an existing record.",
  RATE_LIMITED: "Too many requests. Please wait and try again.",
  UPSTREAM_UNAVAILABLE:
    "A provider is temporarily unavailable. Please retry in a moment.",
  AGENT_UNAVAILABLE:
    "The research agent isn't set up on your Every App gateway yet. An admin sets OPENROUTER_API_KEY with `everyapp secret set OPENROUTER_API_KEY --for gateway`.",
  INTERNAL_ERROR: UNEXPECTED_ERROR_MESSAGE,
};

export function getStandardErrorMessage(
  error: unknown,
  fallback: string = STANDARD_MESSAGES.INTERNAL_ERROR,
): string {
  if (!(error instanceof Error)) return fallback;
  if (isErrorCode(error.message)) return STANDARD_MESSAGES[error.message];
  if (error.message) return error.message;
  return fallback;
}

export function getErrorCode(error: unknown): ErrorCode | null {
  if (!(error instanceof Error)) return null;
  return isErrorCode(error.message) ? error.message : null;
}
