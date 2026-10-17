import type { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";

// One endpoint of the REST API (docs/maintainers/rest-api.md): the feature's
// own Zod schema validates the request and the feature's service does the
// work, with the same context and permission checks as the server function
// for the same action. An endpoint maps the request onto a service call and
// nothing more.

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiRoute {
  method: ApiMethod;
  /** Under /api/v1, with `{name}` for path parameters: "/companies/{id}". */
  path: `/${string}`;
  /** The OpenAPI tag the endpoint is listed under. */
  tag: string;
  summary: string;
  /**
   * The endpoint's input, from its path parameters merged with the query
   * string (GET, DELETE) or the JSON body (POST, PATCH, PUT).
   */
  input: z.ZodType;
  handler: (data: unknown, context: EnsuredUserContext) => Promise<unknown>;
}

/** Declares an endpoint, typing its handler by its input schema. */
export function apiRoute<Schema extends z.ZodType>(route: {
  method: ApiMethod;
  path: `/${string}`;
  tag: string;
  summary: string;
  input: Schema;
  handler: (
    data: z.output<Schema>,
    context: EnsuredUserContext,
  ) => Promise<unknown>;
}): ApiRoute {
  return {
    ...route,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler only ever receives `input.parse(...)`'s output (handler.ts)
    handler: route.handler as ApiRoute["handler"],
  };
}
