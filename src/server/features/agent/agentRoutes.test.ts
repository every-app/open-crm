import { beforeEach, describe, expect, it, vi } from "vitest";

// Every connect and request to a chat is authorized in the Worker before it
// reaches the Durable Object. The agents router is stood in for by one that
// runs the hooks the way routeAgentRequest does, and answers "routed" when
// they let the request through.
const { database, resolveUser } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb(), resolveUser: vi.fn() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/middleware/ensure-user/resolve", () => ({
  resolveUserContextFromHeaders: resolveUser,
}));
type Hook = (
  request: Request,
  route: { className: string; name: string },
) => Promise<Response | undefined>;
vi.mock("agents", () => ({
  routeAgentRequest: async (
    request: Request,
    _env: unknown,
    options: { onBeforeConnect: Hook; onBeforeRequest: Hook },
  ) => {
    const [, , binding, name] = new URL(request.url).pathname.split("/");
    const route = {
      className: binding === "crm-agent" ? "CRM_AGENT" : String(binding),
      name: String(name),
    };
    const hook =
      request.headers.get("upgrade") === "websocket"
        ? options.onBeforeConnect
        : options.onBeforeRequest;
    return (await hook(request, route)) ?? new Response("routed");
  },
}));

import { routeAgentRequests } from "./agentRoutes";
import { sessionName } from "./sessionName";

const chat = sessionName(
  "chat",
  "org_a",
  "11111111-1111-1111-1111-111111111111",
);

function as(organizationId: string, userId: string) {
  resolveUser.mockResolvedValue({
    userId,
    userEmail: "x@a.test",
    organizationId,
    role: "member",
  });
}

async function connect(name: string, websocket = true) {
  const response = await routeAgentRequests(
    new Request(
      `https://crm.test/agents/crm-agent/${name}${websocket ? "" : "/get-messages"}`,
      {
        headers: websocket ? { upgrade: "websocket" } : {},
      },
    ),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in router reads no bindings
    {} as Env,
  );
  return response.status === 200 ? await response.text() : response.status;
}

describe("the agent's chat routes", () => {
  beforeEach(async () => {
    await database.exec(
      `DELETE FROM agent_conversation; DELETE FROM contact; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@a.test', 1);
       INSERT INTO contact (id, organization_id, first_name) VALUES ('c_a', 'org_a', 'Paula');
       INSERT INTO agent_conversation (id, organization_id, contact_id, user_id, session_id) VALUES ('conv', 'org_a', 'c_a', 'user_a', '${chat}');`,
    );
  });

  it("lets the conversation's owner connect and read it", async () => {
    as("org_a", "user_a");
    expect(await connect(chat)).toBe("routed");
    expect(await connect(chat, false)).toBe("routed");
  });

  it("refuses anyone else: another member, another organization, no identity", async () => {
    as("org_a", "user_c");
    expect(await connect(chat)).toBe(403);
    as("org_b", "user_b");
    expect(await connect(chat)).toBe(403);
    resolveUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    expect(await connect(chat)).toBe(401);
  });

  it("never lets a client reach a research session", async () => {
    as("org_a", "user_a");
    expect(await connect(sessionName("task", "org_a", "task-1"))).toBe(403);
  });
});
