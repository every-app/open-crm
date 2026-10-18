import {
  DEV_ISSUER,
  DEV_PRIVATE_KEY_PEM,
  DEV_PUBLIC_KEY_PEM,
  IDENTITY_DEV_KEY_ID,
} from "@every-app/sdk/dev";
import {
  IDENTITY_HEADER,
  SYSTEM_HEADER,
  TOOLS_CALL_PATH,
  TOOLS_LIST_PATH,
  mintIdentityJwt,
  mintSystemJwt,
  type ToolCallResultV1,
  type ToolsListResponseV1,
} from "@every-app/sdk/internal";
import { z } from "zod";
import { everyAppTools } from "@/server/everyapp/tools";

// The MCP tool tests' way in: each call goes through the SDK's tools
// endpoint exactly as the gateway's ToolBus makes it, with an identity minted
// for that one call (the dev keypair, which the SDK trusts under
// EVERYAPP_DEV), so the SDK checks the scope, validates the input and the
// output, and maps errors as it does in production. The test files mock the
// database modules this reaches.

const APP_ID = "crm";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK reads only these keys of the Worker env
const ENV = {
  EVERYAPP_APP_ID: APP_ID,
  EVERYAPP_DEV: "1",
  EVERYAPP_IDENTITY_ISSUER: DEV_ISSUER,
  EVERYAPP_IDENTITY_PUBLIC_KEYS: DEV_PUBLIC_KEY_PEM,
} as unknown as Env;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tools endpoint never touches the execution context
const CTX = { waitUntil: () => {} } as unknown as ExecutionContext;

/** Who calls: a member of an organization, as the gateway signs them. */
export type Caller = {
  sub: string;
  email: string;
  orgId: string;
  orgRole: string;
};

/** org_a's owner and org_b's, as seedTwoOrganizations seeds them. */
export const ana: Caller = {
  sub: "user_a",
  email: "ana@a.test",
  orgId: "org_a",
  orgRole: "owner",
};
export const bo: Caller = {
  sub: "user_b",
  email: "bo@b.test",
  orgId: "org_b",
  orgRole: "owner",
};

/** The scopes the gateway mints for a read-and-write connection. */
export const READ_WRITE = ["mcp:read", "mcp:write"];

const callResponse = z.union([
  z.object({ result: z.custom<ToolCallResultV1>() }),
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
]);

/** One tool call: its result, or the SDK's refusal. */
async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  { as = ana, scopes = READ_WRITE }: { as?: Caller; scopes?: string[] } = {},
) {
  const callId = crypto.randomUUID();
  const identity = await mintIdentityJwt(DEV_PRIVATE_KEY_PEM, {
    subject: as,
    audience: APP_ID,
    issuer: DEV_ISSUER,
    keyId: IDENTITY_DEV_KEY_ID,
    channel: "mcp",
    actor: { sub: "pat:test" },
    scopes,
    toolCall: { id: callId, name },
  });
  const response = await everyAppTools.fetch(
    new Request(`https://crm.test${TOOLS_CALL_PATH}`, {
      method: "POST",
      headers: { [IDENTITY_HEADER]: identity },
      body: JSON.stringify({ v: 1, name, arguments: args, callId }),
    }),
    ENV,
    CTX,
  );
  return callResponse.parse(await response.json());
}

/** A tool's structured result; fails the test on an error. */
export async function call(
  name: string,
  args: Record<string, unknown> = {},
  options?: { as?: Caller; scopes?: string[] },
): Promise<Record<string, unknown>> {
  const response = await callTool(name, args, options);
  if ("error" in response) throw new Error(response.error.message);
  const { result } = response;
  if (result.isError || !result.structuredContent) {
    throw new Error(
      `${name} failed: ${JSON.stringify(result.content.map((block) => block.text))}`,
    );
  }
  return result.structuredContent;
}

/** The id a tool returned, to chain into the next call. */
export async function idFrom(
  name: string,
  args: Record<string, unknown> = {},
  options?: { as?: Caller; scopes?: string[] },
): Promise<string> {
  return z.object({ id: z.string() }).parse(await call(name, args, options)).id;
}

/** What a model reads when a tool fails, or the SDK refuses the call. */
export async function failure(
  name: string,
  args: Record<string, unknown> = {},
  options?: { as?: Caller; scopes?: string[] },
): Promise<string> {
  const response = await callTool(name, args, options);
  if ("error" in response) return response.error.message;
  const { result } = response;
  if (!result.isError) throw new Error(`${name} succeeded`);
  return result.content.map((block) => String(block.text)).join("\n");
}

/** The catalog, as the gateway reads it at deploy. */
export async function catalog(): Promise<ToolsListResponseV1> {
  const token = await mintSystemJwt(DEV_PRIVATE_KEY_PEM, {
    audience: APP_ID,
    issuer: DEV_ISSUER,
    keyId: IDENTITY_DEV_KEY_ID,
    purpose: "tools.list",
  });
  const response = await everyAppTools.fetch(
    new Request(`https://crm.test${TOOLS_LIST_PATH}`, {
      method: "POST",
      headers: { [SYSTEM_HEADER]: token },
      body: JSON.stringify({ v: 1 }),
    }),
    ENV,
    CTX,
  );
  return response.json<ToolsListResponseV1>();
}
