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
  // The gateway holds no key for the agent's model or Context.dev, or the
  // agent isn't set up on this deployment.
  "AGENT_UNAVAILABLE",
  // The gateway holds no OAuth client for the mailbox provider asked for.
  "INTEGRATION_UNAVAILABLE",
  // A team agent that isn't live (a draft, paused or archived) was asked to run.
  "TEAM_AGENT_NOT_LIVE",
  // The team agent already has a run queued or running.
  "TEAM_AGENT_BUSY",
  // Slack isn't set up on the gateway, or the workspace isn't connected.
  "SLACK_UNAVAILABLE",
  // Slack refused the request (a channel name taken, a missing permission).
  "SLACK_REJECTED",
  // The organization is out of usage credits (hosted billing, server/billing).
  "INSUFFICIENT_CREDITS",
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
  "AGENT_UNAVAILABLE",
  "INTEGRATION_UNAVAILABLE",
  "TEAM_AGENT_NOT_LIVE",
  "TEAM_AGENT_BUSY",
  "SLACK_UNAVAILABLE",
  "SLACK_REJECTED",
  "INSUFFICIENT_CREDITS",
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
