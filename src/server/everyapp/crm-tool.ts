import {
  ToolError,
  type EveryAppUser,
  type ToolDefinition,
} from "@every-app/sdk/server";
import type { z } from "zod";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AppError, asAppError } from "@/server/lib/errors";
import {
  forOrganization,
  serveEveryAppRequest,
} from "@/server/lib/gateway-attribution";

type CrmToolHandler<Input> = (
  input: Input,
  context: EnsuredUserContext,
) => Promise<unknown>;

/**
 * One CRM tool: the handler runs as the caller, in the organization their
 * signed identity names, with every gateway call it makes attributed to it
 * (gateway-attribution.ts). AppErrors reach the model as their message.
 */
export function crmTool<Schema extends z.ZodObject>(definition: {
  description: string;
  risk: ToolDefinition["risk"];
  input: Schema;
  handler: CrmToolHandler<z.infer<Schema>>;
}): ToolDefinition {
  return {
    description: definition.description,
    risk: definition.risk,
    input: definition.input,
    handler: async (args, { user, request }) =>
      serveEveryAppRequest(request, user, async () => {
        const context = await resolveContext(user);
        try {
          return await forOrganization(context.organizationId, () =>
            definition.handler(
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK validated args against this tool's own input schema before calling
              args as z.infer<Schema>,
              context,
            ),
          );
        } catch (error) {
          const appError = asAppError(error);
          if (appError) throw new ToolError(appError.message);
          throw error;
        }
      }),
  };
}

function resolveContext(user: EveryAppUser): Promise<EnsuredUserContext> {
  return resolveEveryAppUserContext(user);
}

/** A member's user id from their email, as the tools take owners. */
export async function memberId(organizationId: string, email: string) {
  const members = await AuthRepository.listMembers(organizationId);
  const member = members.find(
    (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!member) {
    throw new AppError(
      "VALIDATION_ERROR",
      `No member of this organization has the email ${email}.`,
    );
  }
  return member.userId;
}
