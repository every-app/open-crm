import { toHex } from "@/server/auth/org-slug";

// A session's id is the name of the CrmAgent Durable Object that holds it, and
// the name carries the organization it works for:
//
//   chat.<organization, hex>.<uuid>     a person's conversation (about a
//                                       record, or with the agent builder)
//   task.<organization, hex>.<task id>  a research session the dispatcher starts
//   run.<organization, hex>.<run id>    a team agent's run the dispatcher starts
//
// Only server code mints names (the dispatcher, and the server function that
// opens a conversation), and a chat name reaches its Durable Object only after
// the Worker has matched its organization and conversation row to the caller's
// signed identity (agentRoutes.ts). The Durable Object then works in the
// organization its own name gives, so no organization ever comes from a
// client. The organization is hex-encoded so the name is URL-safe whatever
// characters the gateway's ids use.

type SessionKind = "chat" | "task" | "run";

type SessionName = {
  kind: SessionKind;
  organizationId: string;
  /** The conversation's uuid, or the task's id. */
  id: string;
};

const NAME = /^(chat|task|run)\.([0-9a-f]+)\.([A-Za-z0-9-]+)$/;

export function sessionName(
  kind: SessionKind,
  organizationId: string,
  id: string,
): string {
  return `${kind}.${toHex(organizationId)}.${id}`;
}

export function parseSessionName(name: string): SessionName | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, kind, hex, id] = match;
  const organizationId = fromHex(hex);
  if (
    !organizationId ||
    (kind !== "chat" && kind !== "task" && kind !== "run")
  ) {
    return null;
  }
  return { kind, organizationId, id };
}

function fromHex(hex: string): string | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) || null;
  } catch {
    return null;
  }
}
