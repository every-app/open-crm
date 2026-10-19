import { brotliCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LOADER_SOURCE, trackerSource } from "./trackerScripts";

type Field = {
  name: string;
  value: string;
  type?: string;
  attributes?: Record<string, string>;
};

const beacon = z.object({
  events: z.array(
    z.object({ type: z.string(), fields: z.unknown().optional() }),
  ),
});

const element = (attributes: Record<string, string> = {}) => ({
  hasAttribute: (name: string) => name in attributes,
  getAttribute: (name: string) => attributes[name] ?? null,
});

// Settings promise a 4 KB tag, and the scripts are hand-written ES5 in
// template literals that nothing else parses before a customer's page does.
describe("tracker scripts", () => {
  const tracker = trackerSource(
    {
      siteId: "cmp_0123456789abcdef",
      crossDomain: true,
      limitToDomains: true,
      cookieSubdomains: false,
      secureCookies: true,
      honourDnt: true,
      cookieDays: 395,
      hosts: [{ host: "acme.com", scope: "SITE_AND_SUBDOMAINS" }],
    },
    "https://crm.example.com/t/e",
  );

  /** The fields the tracker posts when a form is submitted on acme.com. */
  function posted(form: {
    attributes?: Record<string, string>;
    fields: Field[];
  }) {
    const bodies: string[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const page = {
      document: {
        cookie: "",
        referrer: "",
        visibilityState: "visible",
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
      },
      window: {
        location: {
          hostname: "acme.com",
          pathname: "/contact",
          search: "",
          hash: "",
        },
        addEventListener: () => {},
      },
      navigator: {
        sendBeacon: (_url: string, blob: { text: string }) =>
          bodies.push(blob.text),
      },
      history: {},
      Blob: class {
        text: string;
        size: number;
        constructor(parts: string[]) {
          this.text = parts.join("");
          this.size = this.text.length;
        }
      },
      setTimeout: (run: () => void) => run(),
      clearTimeout: () => {},
    };
    Reflect.apply(
      // oxlint-disable-next-line typescript/no-implied-eval -- runs the tracker on a fake page
      new Function(...Object.keys(page), tracker),
      undefined,
      Object.values(page),
    );
    listeners.get("submit")?.({
      target: {
        tagName: "FORM",
        ...element(form.attributes),
        elements: form.fields.map(({ attributes, ...field }) => ({
          ...field,
          ...element(attributes),
        })),
      },
    });
    const events = bodies.flatMap(
      (body) => beacon.parse(JSON.parse(body)).events,
    );
    return events.find((event) => event.type === "form_submit")?.fields ?? null;
  }

  it("are valid JavaScript within their size budget", () => {
    for (const source of [LOADER_SOURCE, tracker]) {
      // oxlint-disable-next-line typescript/no-implied-eval -- parses the scripts without running them
      expect(() => new Function(source)).not.toThrow();
    }
    expect(brotliCompressSync(LOADER_SOURCE).byteLength).toBeLessThanOrEqual(
      1024,
    );
    expect(brotliCompressSync(tracker).byteLength).toBeLessThanOrEqual(4096);
  });

  it("never sends a form with a password field, or one marked data-crm-ignore", () => {
    const email = { name: "email", value: "jane@northwind.example" };
    expect(
      posted({
        fields: [email, { name: "pw", value: "hunter2", type: "password" }],
      }),
    ).toBeNull();
    expect(
      posted({ attributes: { "data-crm-ignore": "" }, fields: [email] }),
    ).toBeNull();
    expect(posted({ fields: [email] })).toEqual({
      email: "jane@northwind.example",
    });
  });

  it("leaves out a field marked data-crm-ignore, and one a sensitive name or autocomplete token names", () => {
    expect(
      posted({
        fields: [
          { name: "email", value: "jane@northwind.example" },
          { name: "notes", value: "x", attributes: { "data-crm-ignore": "" } },
          { name: "dob", value: "1990-04-01" },
          { name: "f7", value: "737", attributes: { autocomplete: "cc-csc" } },
          { name: "social_security_number", value: "078-05-1120" },
        ],
      }),
    ).toEqual({ email: "jane@northwind.example" });
  });
});
