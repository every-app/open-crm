import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { shouldCaptureAppErrorCode } from "@/shared/error-codes";
import { AppError, asAppError, toClientError } from "@/server/lib/errors";

// TanStack's serverFn validator throws a plain Error whose message is the
// JSON-serialized standard-schema issue list. Treat those as input validation,
// not server faults.
function isValidatorError(error: Error): boolean {
  if (!error.message.startsWith("[")) return false;
  try {
    const issues: unknown = JSON.parse(error.message);
    if (!Array.isArray(issues) || issues.length === 0) return false;
    return issues.every(
      (issue: unknown) =>
        typeof issue === "object" &&
        issue !== null &&
        "message" in issue &&
        typeof issue.message === "string",
    );
  } catch {
    return false;
  }
}

export const errorHandlingMiddleware = createMiddleware({
  type: "function",
}).server(async (c) => {
  const { next } = c;

  try {
    return await next();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("INTERNAL_ERROR", { cause: error });
    }

    const appError = isValidatorError(error)
      ? new AppError("VALIDATION_ERROR")
      : asAppError(error);

    if (shouldCaptureAppErrorCode(appError?.code)) {
      const url = new URL(getRequest().url);
      // Details can quote customer content (an upstream response body), so
      // they stay in this log line.
      console.error(
        "server.function error:",
        { errorCode: appError?.code ?? "INTERNAL_ERROR", path: url.pathname },
        error,
        appError?.details ?? "",
      );
    }

    throw toClientError(appError ?? error);
  }
});
