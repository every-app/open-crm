import { hasScope, type EveryAppUser } from "@every-app/sdk/server";
import { sort } from "remeda";
import { z } from "zod";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import type { ApiRoute } from "@/server/api/apiRoute";
import { queryInput } from "@/server/api/inputSchema";
import { openApiDocument } from "@/server/api/openapi";
import { apiRoutes } from "@/server/api/routes";
import { AppError, asAppError } from "@/server/lib/errors";
import {
  shouldCaptureAppErrorCode,
  type ErrorCode,
} from "@/shared/error-codes";

// The REST API (docs/maintainers/rest-api.md). The gateway authenticates the
// caller (a member's browser session or their personal access token) and
// signs their identity onto the request; src/server.ts verified it and hands
// over the user. Each endpoint then runs exactly as its server function does:
// the same context, the same schema, the same service, the same permission
// checks.

export const API_PREFIX = "/api/v1";

/** The scopes a personal access token is made with to limit it to the API. */
export const API_SCOPES = { read: "api:read", write: "api:write" } as const;

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  AUTH_CONFIG_MISSING: 500,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  AGENT_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const NO_STORE = { "cache-control": "no-store" };

interface Issue {
  path: string;
  message: string;
}

/** Every error has this body: the code is stable, the message is for people. */
function errorResponse(code: ErrorCode, message?: string, issues?: Issue[]) {
  return Response.json(
    {
      code,
      message: message ?? getStandardErrorMessage(new Error(code)),
      ...(issues ? { issues } : {}),
    },
    { status: HTTP_STATUS[code], headers: NO_STORE },
  );
}

// Client errors carry the service's own words ("No company with id x."), as
// the MCP tools do; server faults only the code's copy, since their messages
// can hold internal detail. Those stay in the logs.
function appErrorResponse(error: AppError) {
  const clientFault = HTTP_STATUS[error.code] < 500;
  return errorResponse(
    error.code,
    clientFault && error.message !== error.code ? error.message : undefined,
  );
}

interface CompiledRoute {
  route: ApiRoute;
  pattern: RegExp;
  names: string[];
}

function compile(route: ApiRoute): CompiledRoute {
  const names: string[] = [];
  const source = route.path
    .split("/")
    .map((segment) => {
      const name = /^\{(\w+)\}$/.exec(segment)?.[1];
      if (!name) return segment.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      names.push(name);
      return "([^/]+)";
    })
    .join("/");
  return { route, pattern: new RegExp(`^${source}$`), names };
}

// A literal segment wins over a parameter: /companies/options before
// /companies/{id}.
const compiledRoutes = sort(
  apiRoutes.map(compile),
  (a, b) => a.names.length - b.names.length,
);

function matchRoute(method: string, path: string) {
  for (const compiled of compiledRoutes) {
    if (compiled.route.method !== method) continue;
    const found = compiled.pattern.exec(path);
    if (!found) continue;
    try {
      const params = Object.fromEntries(
        compiled.names.map((name, index) => [
          name,
          decodeURIComponent(found[index + 1] ?? ""),
        ]),
      );
      return { route: compiled.route, params };
    } catch {
      return null;
    }
  }
  return null;
}

const jsonObject = z.record(z.string(), z.unknown());

async function bodyInput(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "The request body is not JSON.");
  }
  const parsed = jsonObject.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The request body must be a JSON object.",
    );
  }
  return parsed.data;
}

/**
 * Whether the caller's credential lets it do this. A browser session and a
 * token made without scopes hold `*`; a token made with `api:read` only reads.
 */
function scopeAllows(user: EveryAppUser, method: string) {
  if (method === "GET") {
    return hasScope(user, API_SCOPES.read) || hasScope(user, API_SCOPES.write);
  }
  return hasScope(user, API_SCOPES.write);
}

export async function handleApiRequest(
  request: Request,
  user: EveryAppUser | null,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length);
  const method = request.method.toUpperCase();
  try {
    if (!user) throw new AppError("UNAUTHENTICATED");
    if (method === "GET" && path === "/openapi.json") {
      return Response.json(openApiDocument(url.origin), { headers: NO_STORE });
    }
    const match = matchRoute(method, path);
    if (!match) {
      return errorResponse(
        "NOT_FOUND",
        `There is no ${method} ${API_PREFIX}${path}. Every endpoint is listed at ${API_PREFIX}/openapi.json.`,
      );
    }
    if (!scopeAllows(user, method)) {
      return errorResponse(
        "FORBIDDEN",
        "This token can only read. Make a token with write access on Every App to change records.",
      );
    }
    const context = await resolveEveryAppUserContext(user);
    const fromRequest =
      method === "GET" || method === "DELETE"
        ? queryInput(match.route.input, url.searchParams)
        : await bodyInput(request);
    const parsed = match.route.input.safeParse({
      ...fromRequest,
      ...match.params,
    });
    if (!parsed.success) {
      return errorResponse(
        "VALIDATION_ERROR",
        undefined,
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    const result = await match.route.handler(parsed.data, context);
    return Response.json(result ?? null, { headers: NO_STORE });
  } catch (error) {
    const appError = asAppError(error);
    if (shouldCaptureAppErrorCode(appError?.code)) {
      console.error(
        "api error:",
        { errorCode: appError?.code ?? "INTERNAL_ERROR", method, path },
        error,
        appError?.details ?? "",
      );
    }
    return appError
      ? appErrorResponse(appError)
      : errorResponse("INTERNAL_ERROR");
  }
}
