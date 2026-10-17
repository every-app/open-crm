import type { ApiRoute } from "@/server/api/apiRoute";
import { inputJsonSchema, type JsonSchema } from "@/server/api/inputSchema";
import { apiRoutes } from "@/server/api/routes";

// GET /api/v1/openapi.json: built on request from the endpoints' own Zod
// schemas, so the document is whatever the routes are. Nothing is generated
// at build time or checked in.

const PREFIX = "/api/v1";

const DESCRIPTION = `The CRM's companies, contacts, deals, activities, custom fields and saved views over REST.

Authenticate with a personal access token from your Every App gateway: \`Authorization: Bearer epat_...\`. The token acts as you, in your organization, with your role: anything you can't do in the CRM, it can't either. A token made with only the \`api:read\` scope can read but not write.

Errors answer with an HTTP status and \`{ "code", "message", "issues"? }\`: \`code\` is stable (NOT_FOUND, VALIDATION_ERROR, FORBIDDEN, CONFLICT, ...), \`message\` is for people, and \`issues\` lists what was wrong with the input.`;

const errorSchema: JsonSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          message: { type: "string" },
        },
        required: ["path", "message"],
      },
    },
  },
  required: ["code", "message"],
};

function operationId(route: ApiRoute) {
  const path = route.path
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${route.method.toLowerCase()}_${path}`;
}

/** `value` with every `#/$defs/x` reference pointed at `#/components/schemas/<prefix>x`. */
function rehome(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rehome(item, prefix));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      key === "$ref" && typeof inner === "string"
        ? inner.replace("#/$defs/", `#/components/schemas/${prefix}`)
        : rehome(inner, prefix),
    ]),
  );
}

function operation(route: ApiRoute, schemas: Record<string, unknown>) {
  const id = operationId(route);
  const fix = (value: unknown) => rehome(value, `${id}_`);
  const {
    $schema: _,
    $defs,
    properties = {},
    required = [],
  } = inputJsonSchema(route.input);
  for (const [name, definition] of Object.entries($defs ?? {})) {
    schemas[`${id}_${name}`] = fix(definition);
  }

  const pathNames = [...route.path.matchAll(/\{(\w+)\}/g)].map(
    (match) => match[1] ?? "",
  );
  const parameters: unknown[] = pathNames.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: fix(properties[name] ?? { type: "string" }),
  }));
  const others = Object.entries(properties).filter(
    ([name]) => !pathNames.includes(name),
  );

  let requestBody: unknown;
  if (route.method === "GET" || route.method === "DELETE") {
    for (const [name, schema] of others) {
      parameters.push({
        name,
        in: "query",
        required: required.includes(name),
        schema: fix(schema),
      });
    }
  } else if (others.length > 0) {
    const bodyRequired = required.filter((name) => !pathNames.includes(name));
    requestBody = {
      required: bodyRequired.length > 0,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: fix(Object.fromEntries(others)),
            ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
          },
        },
      },
    };
  }

  return {
    operationId: id,
    tags: [route.tag],
    summary: route.summary,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      "200": {
        description: "What the action returns, as JSON.",
        content: { "application/json": { schema: {} } },
      },
      default: {
        description: "The request failed.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
  };
}

export function openApiDocument(origin: string) {
  const schemas: Record<string, unknown> = { Error: errorSchema };
  const paths: Record<string, Record<string, unknown>> = {
    [`${PREFIX}/openapi.json`]: {
      get: {
        operationId: "get_openapi_json",
        tags: ["API"],
        summary: "This document.",
        responses: { "200": { description: "The OpenAPI document." } },
      },
    },
  };
  for (const route of apiRoutes) {
    const path = `${PREFIX}${route.path}`;
    paths[path] = {
      ...paths[path],
      [route.method.toLowerCase()]: operation(route, schemas),
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Open CRM API", version: "1", description: DESCRIPTION },
    servers: [{ url: origin }],
    security: [{ personalAccessToken: [] }],
    components: {
      securitySchemes: {
        personalAccessToken: {
          type: "http",
          scheme: "bearer",
          description:
            "A personal access token (epat_...) from your Every App gateway.",
        },
      },
      schemas,
    },
    paths,
  };
}
