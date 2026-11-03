import { vi } from "vitest";

// Fakes for the mailbox tests, at the network boundary only: the Every App
// gateway's binding (each provider's status, and the proxy that puts a
// member's token on their calls) and the providers' APIs (global fetch),
// with payloads shaped like Google's and Microsoft's.

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `column` of the first row a test database query returned. */
export async function firstValue(
  rows: Promise<unknown[]>,
  column: string,
): Promise<unknown> {
  const [row] = await rows;
  return row && typeof row === "object" ? Reflect.get(row, column) : undefined;
}

type GatewayCall = {
  provider: string;
  upstream: URL;
  headers: Headers;
};

/**
 * The gateway's binding: every provider is offered, and every member is
 * connected unless `disconnect`ed, when their calls answer 409
 * `integration_not_connected`. A call it lets through goes to the
 * providers' fake APIs (stubProviders) at the real URL.
 */
export function createGateway() {
  const calls: GatewayCall[] = [];
  const disconnected = new Set<string>();
  let ready = true;
  // The caller's own connection, as the status reports it.
  let connection: unknown = {
    account: "user",
    label: null,
    scopeSets: [],
    ready: true,
  };
  const binding = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const [, , , provider = "", host, ...path] = url.pathname.split("/");
      if (!host) {
        return json({
          requested: true,
          configured: ready,
          ready,
          settings: ready ? [] : ["GOOGLE_WORKSPACE_CLIENT_ID"],
          setup: ready ? null : "An admin adds the provider.",
          command: ready ? null : "pnpm everyapp provider add",
          connection: ready ? connection : null,
        });
      }
      const upstream = new URL(
        `https://${host}/${path.join("/")}${url.search}`,
      );
      calls.push({ provider, upstream, headers: request.headers });
      const userId = request.headers.get("x-everyapp-user") ?? "";
      if (!ready || disconnected.has(userId)) {
        return new Response(
          JSON.stringify({
            error: {
              code: "integration_not_connected",
              message: "Not connected: connect again.",
            },
          }),
          {
            status: 409,
            headers: {
              "content-type": "application/json",
              "x-everyapp-error": "integration_not_connected",
            },
          },
        );
      }
      return globalThis.fetch(upstream);
    },
  };
  return {
    binding,
    calls,
    disconnect(userId: string) {
      disconnected.add(userId);
    },
    reset() {
      calls.length = 0;
      disconnected.clear();
      ready = true;
      connection = { account: "user", label: null, scopeSets: [], ready: true };
    },
    /** The caller's connection as the status reports it (null: none). */
    setStatusConnection(value: unknown) {
      connection = value;
    },
    setReady(value: boolean) {
      ready = value;
    },
  };
}

type Route = (url: URL) => unknown;

/**
 * Stubs global fetch with the providers' APIs: `routes` by host and path
 * (`gmail.googleapis.com/gmail/v1/users/me/profile`), each answering JSON or
 * a Response. Anything else is a 404. Returns the URLs fetched.
 */
export function stubProviders(routes: Record<string, Route>) {
  const fetched: URL[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    fetched.push(url);
    const route = routes[`${url.host}${url.pathname}`];
    if (!route) {
      return json({ error: { message: `No route for ${url.pathname}` } }, 404);
    }
    const answer = route(url);
    return answer instanceof Response ? answer : json(answer);
  });
  return fetched;
}

const base64Url = (text: string) =>
  Buffer.from(text, "utf8").toString("base64url");

/** A Gmail `messages/<id>?format=full` answer: multipart text and HTML. */
export function gmailMessage(input: {
  id: string;
  messageId: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  sentAt: string;
  references?: string;
}) {
  const headers = [
    { name: "Message-ID", value: `<${input.messageId}>` },
    { name: "From", value: input.from },
    { name: "To", value: input.to },
    ...(input.cc ? [{ name: "Cc", value: input.cc }] : []),
    { name: "Subject", value: input.subject },
    ...(input.references
      ? [
          { name: "References", value: input.references },
          { name: "In-Reply-To", value: input.references.split(" ").at(-1) },
        ]
      : []),
  ];
  return {
    id: input.id,
    threadId: `t-${input.id}`,
    internalDate: String(Date.parse(input.sentAt)),
    payload: {
      mimeType: "multipart/mixed",
      headers,
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: base64Url(
                  `${input.text}\n\nOn Mon, someone wrote:\n> quoted history`,
                ),
              },
            },
            {
              mimeType: "text/html",
              body: { data: base64Url(`<p>${input.text}</p>`) },
            },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "deck.pdf",
          body: { attachmentId: "att-1" },
        },
      ],
    },
  };
}

/** Days from now, as an ISO timestamp. */
export function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
