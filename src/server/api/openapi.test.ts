import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The routes import the services; nothing here touches a database.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));
import { openApiDocument } from "./openapi";
import { apiRoutes } from "./routes";

const operationSchema = z.object({
  parameters: z
    .array(z.object({ name: z.string(), in: z.string() }))
    .optional(),
});

describe("openApiDocument", () => {
  const document = openApiDocument("https://crm.test");

  it("lists every endpoint with its path parameters", () => {
    for (const route of apiRoutes) {
      const operation = operationSchema.parse(
        document.paths[`/api/v1${route.path}`]?.[route.method.toLowerCase()],
      );
      const pathParameters = [...route.path.matchAll(/\{(\w+)\}/g)].map(
        (match) => match[1],
      );
      expect(
        (operation.parameters ?? [])
          .filter((parameter) => parameter.in === "path")
          .map((parameter) => parameter.name),
      ).toEqual(pathParameters);
    }
  });

  it("points every reference at a schema the document holds", () => {
    const refs = [
      ...JSON.stringify(document).matchAll(
        /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(JSON.stringify(document)).not.toContain("#/$defs/");
    for (const ref of refs) {
      expect(document.components.schemas, ref).toHaveProperty([ref]);
    }
  });
});
