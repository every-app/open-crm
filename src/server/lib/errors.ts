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

/**
 * What a log line may say of an error: its name and code. A database error's
 * message quotes the query's parameters (tokens among them), and so may its
 * cause's, so neither message is logged.
 */
export function loggableError(error: unknown): {
  error: string;
  code?: string;
} {
  if (!(error instanceof Error)) return { error: typeof error };
  const code = codeOf(error) ?? codeOf(error.cause);
  return code ? { error: error.name, code } : { error: error.name };
}

/** An AppError's code, a driver's (Postgres's SQLSTATE, libSQL's), or the SQLite code D1 ends its message with. */
function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code: unknown = Reflect.get(error, "code");
  if (typeof code === "string" || typeof code === "number") return String(code);
  return /\bSQLITE_[A-Z_]+\b/.exec(error.message)?.[0];
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
