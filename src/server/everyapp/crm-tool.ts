import { ToolError, type ToolDefinition } from "@every-app/sdk/server";
import { z } from "zod";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AppError, asAppError } from "@/server/lib/errors";
import {
  forOrganization,
  serveEveryAppRequest,
} from "@/server/lib/gateway-attribution";

/** What a tool handler gets besides its input: the CRM's public origin. */
type ToolCall = { origin: string };

/**
 * One CRM tool: the handler runs as the caller, in the organization their
 * signed identity names, with every gateway call it makes attributed to it
 * (gateway-attribution.ts). The SDK checks the input against `input` before
 * the handler runs and its result against `output` after, keeping only the
 * fields `output` names. AppErrors reach the model as their message.
 */
export function crmTool<
  Input extends z.ZodObject,
  Output extends z.ZodObject,
>(definition: {
  description: string;
  risk: ToolDefinition["risk"];
  input: Input;
  output: Output;
  handler: (
    input: z.output<Input>,
    context: EnsuredUserContext,
    call: ToolCall,
  ) => Promise<z.input<Output>>;
}): ToolDefinition {
  return {
    description: definition.description,
    risk: definition.risk,
    input: definition.input,
    output: definition.output,
    handler: async (args, { user, request }) =>
      serveEveryAppRequest(request, user, async () => {
        try {
          const context = await resolveEveryAppUserContext(user);
          return await forOrganization(context.organizationId, () =>
            definition.handler(
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK validated args against this tool's own input schema before calling
              args as z.output<Input>,
              context,
              { origin: new URL(request.url).origin },
            ),
          );
        } catch (error) {
          const appError = asAppError(error);
          // A server fault's message can hold internal detail: the SDK logs
          // it and tells the model only "Internal error" with a reference.
          if (!appError || appError.code === "INTERNAL_ERROR") throw error;
          throw new ToolError(
            appError.message === appError.code
              ? getStandardErrorMessage(new Error(appError.code))
              : appError.message,
          );
        }
      }),
  };
}

/** A member's user id from their email, as the tools take people. */
export async function memberId(organizationId: string, email: string) {
  const members = await AuthRepository.listMembers(organizationId);
  const member = members.find(
    (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!member) {
    throw new AppError(
      "VALIDATION_ERROR",
      `No member of this organization has the email ${email}. list_members gives them.`,
    );
  }
  return member.userId;
}

// Shapes several tools return.

/** A person by name and email, as models know people. */
export const personOutput = z.object({ name: z.string(), email: z.string() });

/** A record by id and name, to chain into the next call. */
export const recordRefOutput = z.object({ id: z.string(), name: z.string() });

export function fullName(person: {
  firstName: string;
  lastName: string | null;
}) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

/** The page of a list a tool returns, from `page` (1-based) and `size`. */
export function pageOf<T>(rows: T[], page: number, size: number) {
  return {
    total: rows.length,
    page,
    pageSize: size,
    rows: rows.slice((page - 1) * size, page * size),
  };
}

export const pageInput = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe("The page, from 1.");
