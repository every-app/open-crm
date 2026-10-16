import { beforeEach, describe, expect, it, vi } from "vitest";

const { bucket, resolveUser } = vi.hoisted(() => {
  const objects = new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; contentType?: string }
  >();
  return {
    resolveUser: vi.fn(),
    bucket: {
      put: async (
        key: string,
        bytes: Uint8Array<ArrayBuffer>,
        options?: { httpMetadata?: { contentType?: string } },
      ) => {
        objects.set(key, {
          bytes,
          contentType: options?.httpMetadata?.contentType,
        });
      },
      get: async (key: string) => {
        const object = objects.get(key);
        if (!object) return null;
        return {
          body: new Blob([object.bytes]).stream(),
          httpMetadata: { contentType: object.contentType },
          httpEtag: '"etag"',
        };
      },
    },
  };
});
vi.mock("cloudflare:workers", () => ({ env: { R2: bucket } }));
vi.mock("@/middleware/ensure-user/resolve", () => ({
  resolveUserContextFromHeaders: resolveUser,
}));

import { serveImage, storeImage } from "./images";

const PNG = new Uint8Array(new ArrayBuffer(7));
PNG.set([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake implements what serveImage reads
const bindings = { R2: bucket as unknown as R2Bucket };

function member(organizationId: string) {
  return { userId: "u", userEmail: "u@x.test", organizationId, role: "member" };
}

const get = (path: string) =>
  serveImage(new Request(`https://crm.test${path}`), bindings);

describe("stored images", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(PNG, { headers: { "content-type": "image/png" } }),
      ),
    );
    resolveUser.mockResolvedValue(member("org_a"));
  });

  it("serves an organization's image only to its own members", async () => {
    const path = await storeImage(
      "org_a",
      "companies/co1/logoUrl",
      "https://cdn.test/logo.png",
    );
    expect(path).toMatch(
      /^\/api\/images\/org_a\/companies\/co1\/logoUrl-[0-9a-f]{12}\.png$/,
    );

    const response = await get(path ?? "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);

    resolveUser.mockResolvedValue(member("org_b"));
    expect((await get(path ?? "")).status).toBe(404);
  });

  it("refuses a caller with no verified identity", async () => {
    const path = await storeImage(
      "org_a",
      "contacts/c1/photo",
      "https://cdn.test/face.png",
    );
    resolveUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    expect((await get(path ?? "")).status).toBe(401);
  });

  it("does not let a path climb out of the organization's prefix", async () => {
    await bucket.put("org_b/companies/co9/logoUrl-abc.png", PNG);
    expect(
      (await get("/api/images/org_a/..%2Forg_b/companies/co9/logoUrl-abc.png"))
        .status,
    ).toBe(404);
    expect(
      (await get("/api/images/org_a/../org_b/companies/co9/logoUrl-abc.png"))
        .status,
    ).toBe(404);
  });

  it("keeps nothing that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html></html>", {
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    expect(
      await storeImage("org_a", "contacts/c1/photo", "https://cdn.test/page"),
    ).toBeNull();
  });
});
