import {
  UserMessageError,
  isErrorCode,
  type ErrorCode,
} from "@/shared/error-codes";

/** Copy for an error we did not expect. */
const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Try again in a moment.";

const STANDARD_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Sign in on Every App and try again.",
  AUTH_CONFIG_MISSING:
    "The CRM isn't set up on your Every App gateway yet. Deploy it with `everyapp deploy`.",
  FORBIDDEN: "Only an owner or an admin can do that.",
  NOT_FOUND: "The requested record was not found.",
  VALIDATION_ERROR: "Check your input and try again.",
  CONFLICT: "This conflicts with an existing record.",
  RATE_LIMITED: "Too many requests. Try again in a moment.",
  UPSTREAM_UNAVAILABLE: "A provider is unavailable. Try again in a moment.",
  INTEGRATION_UNAVAILABLE:
    "That connection isn't set up on this Every App gateway yet. An admin sets it up there.",
  INTERNAL_ERROR: UNEXPECTED_ERROR_MESSAGE,
};

export function getStandardErrorMessage(
  error: unknown,
  fallback: string = STANDARD_MESSAGES.INTERNAL_ERROR,
): string {
  if (!(error instanceof Error)) return fallback;
  // The server's own words, when it wrote them for people.
  if (error instanceof UserMessageError) return error.userMessage;
  if (isErrorCode(error.message)) return STANDARD_MESSAGES[error.message];
  if (error.message) return error.message;
  return fallback;
}

export function getErrorCode(error: unknown): ErrorCode | null {
  if (!(error instanceof Error)) return null;
  return isErrorCode(error.message) ? error.message : null;
}
