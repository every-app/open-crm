import { z } from "zod";

const ERROR_CODES = [
  "UNAUTHENTICATED",
  "AUTH_CONFIG_MISSING",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  // The gateway holds no OAuth client for the mailbox provider asked for.
  "INTEGRATION_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

const NON_REPORTABLE_ERROR_CODES = new Set<ErrorCode>([
  "UNAUTHENTICATED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTEGRATION_UNAVAILABLE",
  // An external provider failing on its own side: nothing in the app to fix.
  "UPSTREAM_UNAVAILABLE",
]);

/**
 * A server error as the browser receives it when the server wrote its words
 * for people (server/lib/errors.ts's UserFacingError): the code as its
 * message, like every error the browser gets, plus those words. start.ts
 * carries it over whole; Start sends any other error as its message alone.
 */
export class UserMessageError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly userMessage: string,
  ) {
    super(code);
    this.name = "UserMessageError";
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return errorCodeSchema.safeParse(value).success;
}

export function shouldCaptureAppErrorCode(
  code: ErrorCode | null | undefined,
): boolean {
  return code == null || !NON_REPORTABLE_ERROR_CODES.has(code);
}
