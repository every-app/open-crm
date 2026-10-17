import { vi } from "vitest";

// Fakes for the mailbox tests, at the network boundary only: the Every App
// gateway's binding (each OAuth client's status and token endpoint) and the
// providers' APIs (global fetch), with payloads shaped like Google's and
// Microsoft's.

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

type TokenCall = {
  capability: string;
  path: string;
  form: URLSearchParams;
  headers: Headers;
};

/**
 * The gateway's binding: every OAuth client is held (`clientId`
 * `client-<capability>`), and token calls are answered by `onToken`,
 * defaulting to fresh tokens.
 */
export function createGateway() {
  const tokenCalls: TokenCall[] = [];
  let onToken: (call: TokenCall) => Response = () =>
    json({ access_token: "fresh-access", expires_in: 3600 });
  let ready = true;
  const binding = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const [, , , capability = ""] = url.pathname.split("/");
      if (request.method === "GET") {
        return json({
          capability,
          requested: true,
          configured: ready,
          ready,
          ...(ready ? { clientId: `client-${capability}` } : {}),
        });
      }
      const call = {
        capability,
        path: url.pathname,
        form: new URLSearchParams(await request.text()),
        headers: request.headers,
      };
      tokenCalls.push(call);
      return onToken(call);
    },
  };
  return {
    binding,
    tokenCalls,
    answerTokens(handler: (call: TokenCall) => Response) {
      onToken = handler;
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
