import {
  UserMessageError,
  isErrorCode,
  type ErrorCode,
} from "@/shared/error-codes";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

/**
 * An AppError whose message is written for the person who asked, such as
 * "Stripe already uses the domain stripe.com.": the browser shows it in place
 * of its code's copy. Nothing internal goes in one.
 */
export class UserFacingError extends AppError {}

export function asAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  if (error instanceof Error && isErrorCode(error.message)) {
    return new AppError(error.message, error.message);
  }
  return null;
}

// The client receives the code, and a UserFacingError's message with it.
// Any other message can carry internal detail, so the client maps its code
// to its own copy and the full message stays in the server logs.
export function toClientError(error: unknown): Error {
  const appError = asAppError(error);
  if (appError instanceof UserFacingError) {
    return new UserMessageError(appError.code, appError.message);
  }
  return new Error(appError?.code ?? "INTERNAL_ERROR");
}
