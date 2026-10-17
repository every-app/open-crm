import { z } from "zod";

// An endpoint's input as JSON Schema (Zod 4's own conversion), for the OpenAPI
// document and for reading a query string as the schema expects: numbers,
// booleans and repeated keys for arrays.

export type JsonSchema = z.core.JSONSchema.BaseSchema;

const converted = new WeakMap<z.ZodType, JsonSchema>();

/** What a client sends: defaults are optional, transforms show their input. */
export function inputJsonSchema(schema: z.ZodType): JsonSchema {
  let json = converted.get(schema);
  if (!json) {
    json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    converted.set(schema, json);
  }
  return json;
}

function propertySchema(
  schema: z.ZodType,
  key: string,
): JsonSchema | undefined {
  const property = inputJsonSchema(schema).properties?.[key];
  return typeof property === "object" ? property : undefined;
}

function scalar(property: JsonSchema | undefined, value: string): unknown {
  switch (property?.type) {
    case "number":
    case "integer": {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) ? number : value;
    }
    case "boolean":
      return value === "true" ? true : value === "false" ? false : value;
    default:
      return value;
  }
}

/**
 * A query string as `schema`'s input: `?page=2&archived=true&stage=A&stage=B`
 * reads as `{ page: 2, archived: true, stage: ["A", "B"] }`. Anything that
 * doesn't convert is left as text for the schema to refuse.
 */
export function queryInput(
  schema: z.ZodType,
  params: URLSearchParams,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const property = propertySchema(schema, key);
    const values = params.getAll(key);
    if (property?.type === "array") {
      const items =
        typeof property.items === "object" && !Array.isArray(property.items)
          ? property.items
          : undefined;
      input[key] = values.map((value) => scalar(items, value));
    } else {
      input[key] = scalar(property, values.at(-1) ?? "");
    }
  }
  return input;
}
