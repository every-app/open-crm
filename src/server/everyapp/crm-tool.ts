import { ToolError, type ToolDefinition } from "@every-app/sdk/server";
import { z } from "zod";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AppError, asAppError } from "@/server/lib/errors";
import { RECORD_SOURCES } from "@/shared/crm-enums";
import {
  forOrganization,
  serveEveryAppRequest,
} from "@/server/lib/gateway-attribution";
import { OWNER_FILTER_MAX } from "@/types/schemas/records";

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

/**
 * A member's user id from their email or their id, as the tools take people:
 * list_members gives both, and a saved view keeps its owners by id.
 */
export async function memberId(organizationId: string, person: string) {
  const members = await AuthRepository.listMembers(organizationId);
  const wanted = person.trim();
  const member = members.find(
    (candidate) =>
      candidate.userId === wanted ||
      candidate.email.toLowerCase() === wanted.toLowerCase(),
  );
  if (!member) {
    throw new AppError(
      "VALIDATION_ERROR",
      `No member of this organization is ${person}. list_members gives them.`,
    );
  }
  return member.userId;
}

/** A list's owner filter, as the list tools take it. */
export const ownersInput = z
  .array(z.string().trim().min(1))
  .max(OWNER_FILTER_MAX)
  .optional();

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

/** A record list's rows a page, as the list tools take it. */
export const pageSizeInput = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Rows a page: 25 unless said, at most 100.");

/** A deal's amount in the reporting currency, as the tools show it. */
export const reportedOutput = z
  .object({ amount: z.number(), currency: z.string() })
  .nullable()
  .describe("The amount in the reporting currency, when a rate converts it.");

/** The amount in the reporting currency, when a rate converted it. */
export function reported(
  deal: { baseAmount: number | null; baseCurrency: string | null },
  reportingCurrency: string,
) {
  return deal.baseAmount !== null && deal.baseCurrency === reportingCurrency
    ? { amount: deal.baseAmount, currency: reportingCurrency }
    : null;
}

/** How a company or contact came into the CRM. */
export const sourceOutput = z
  .enum(RECORD_SOURCES)
  .describe(
    "How it came in: MANUAL (added by hand or a tool), IMPORT (a CSV), EMAIL or CALENDAR (captured), TRACKING (a website form).",
  );
