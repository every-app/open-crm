import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AppError } from "@/server/lib/errors";
import { hasOrgPermission } from "@/shared/org-permissions";
import { TeamAgentRepository } from "../repositories/TeamAgentRepository";

// Who may see and change a team agent, as the CRM's agent-access.service.ts:
// a DRAFT is its creator's alone (anyone else is told it doesn't exist); a
// deployed agent is the team's to see and run, and its creator's or an owner's
// or admin's to change.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

type Agent = NonNullable<Awaited<ReturnType<typeof TeamAgentRepository.findById>>>;

/** The agent, if the person may see it; NOT_FOUND otherwise. */
export async function readableAgent(
  context: Context,
  agentId: string,
): Promise<Agent> {
  const agent = await TeamAgentRepository.findById(
    context.organizationId,
    agentId,
  );
  if (!agent) throw new AppError("NOT_FOUND");
  if (agent.status === "DRAFT" && agent.createdById !== context.userId) {
    throw new AppError("NOT_FOUND");
  }
  return agent;
}

export function canManageAgent(
  context: Pick<Context, "userId" | "role">,
  agent: Pick<Agent, "createdById">,
): boolean {
  return (
    agent.createdById === context.userId ||
    hasOrgPermission(context.role, { agent: ["manage"] })
  );
}

/** The agent, if the person may change it; FORBIDDEN or NOT_FOUND otherwise. */
export async function manageableAgent(
  context: Context,
  agentId: string,
): Promise<Agent> {
  const agent = await readableAgent(context, agentId);
  if (!canManageAgent(context, agent)) throw new AppError("FORBIDDEN");
  return agent;
}
