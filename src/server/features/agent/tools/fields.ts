import { tool } from "ai";
import { z } from "zod";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import { AppError } from "@/server/lib/errors";
import {
  FIELD_ENTITIES,
  FIELD_TYPES,
  type FieldEntity,
} from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";
import { hasOrgPermission } from "@/shared/org-permissions";
import { createFieldSchema, updateFieldSchema } from "@/types/schemas/fields";
import type { AgentToolContext, ToolGroup } from "./context";

// Custom fields, ported from the CRM's list_fields, set_field_value,
// manage_fields and archive_field. Every write goes through the fields
// feature's services, so the agent's values and fields are checked exactly as
// a person's are. Adding, changing and archiving fields is an owner's or an
// admin's (Settings → Fields), so the agent does it only for one of them, in
// their conversation; archiving also waits for them to approve it.

const entity = z
  .enum(FIELD_ENTITIES)
  .describe("Which record type the fields belong to.");

const MEMBER_FIELDS =
  "Only an owner or admin can change this CRM's fields. Tell the rep which field you would add or change and why, and ask an owner or admin to do it from the Fields sheet.";

const UNATTENDED_FIELDS =
  "Not something to do unattended: changing this CRM's fields is a person's call. Say which field you would add or change and why, and leave it to an owner or admin.";

/** Why the agent may not change fields in this session, or null when it may. */
function refusal(context: AgentToolContext): string | null {
  if (!context.attended) return UNATTENDED_FIELDS;
  return context.role && hasOrgPermission(context.role, { field: ["manage"] })
    ? null
    : MEMBER_FIELDS;
}

/** The entity's field called `key`, archived ones included when asked. */
async function fieldByKey(
  context: AgentToolContext,
  fieldEntity: FieldEntity,
  key: string,
  includeArchived: boolean,
) {
  const fields = await FieldsService.list(context.organizationId, fieldEntity, {
    includeArchived,
  });
  return fields.find((field) => field.key === key) ?? null;
}

/** An AppError's message for the model; anything else is a tool failure. */
function rejection(error: unknown): string {
  if (error instanceof AppError) return error.message;
  throw error;
}

export const fieldTools: ToolGroup = (context) => ({
  list_fields: tool({
    description:
      "List the custom fields a workspace has added to companies, contacts or deals — their key, type, options, and the brief saying what would count as an answer. Free. Read this before setting any custom value, and before telling a rep a field does not exist.",
    inputSchema: z.object({ entity }),
    execute: async ({ entity: fieldEntity }) => {
      const fields = await FieldsService.list(
        context.organizationId,
        fieldEntity,
      );
      return {
        fields: fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          agentFilled: field.agentFilled,
          brief: field.agentBrief,
          options: field.options.map((option) => option.label),
        })),
        note:
          fields.length === 0
            ? "This workspace has no custom fields on this record type yet."
            : "Fields marked agentFilled false are the rep's to keep — do not write to them.",
      };
    },
  }),

  set_field_value: tool({
    description:
      "Set one custom field on one record, when you have read the answer from a source rather than guessed it. The field's brief says what would count — follow it. Call list_fields first if you do not know the key. A field the rep marked manual will refuse.",
    inputSchema: z.object({
      entity,
      recordId: z.string().describe("The id of the company, contact or deal."),
      key: z
        .string()
        .describe("The field's key, exactly as list_fields reports it."),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.null()])
        .describe(
          "The value. A select takes the option's label, a date takes YYYY-MM-DD, and null clears it.",
        ),
    }),
    execute: async ({ entity: fieldEntity, recordId, key, value }) => {
      const field = await fieldByKey(context, fieldEntity, key, false);
      if (!field) {
        return {
          written: false as const,
          reason: `There is no field called "${key}" on ${ENTITY_NOUNS[fieldEntity].many}. Call list_fields to see what exists.`,
        };
      }
      if (!field.agentFilled) {
        return {
          written: false as const,
          reason: `"${key}" is marked manual only, so a rep keeps it by hand.`,
        };
      }
      // A field-backfill task was queued for a blank: it fills only a blank,
      // never what somebody wrote since.
      const onlyIfEmpty = context.task?.kind === "field-backfill";
      try {
        const result = await FieldValuesService.setValues(
          context.organizationId,
          fieldEntity,
          recordId,
          { [key]: value },
          { onlyIfEmpty },
        );
        if (result.skipped.includes(key)) {
          return {
            written: false as const,
            reason:
              value === null
                ? `"${key}" is only filled here, never cleared.`
                : `"${key}" already has a value on this record. Someone filled it since this task was queued — leave it as is.`,
          };
        }
        return { written: true as const, key, value };
      } catch (error) {
        return { written: false as const, reason: rejection(error) };
      }
    },
  }),

  manage_fields: tool({
    description:
      "Add a custom field to a record type, or change what a field's brief tells you to look for. Use it when a rep asks the CRM to start tracking something it has no field for. The brief is the whole instruction you will be working from later, so write it the way you would want to read it.",
    inputSchema: z.object({
      action: z.enum(["create", "update-brief"]),
      entity: z.enum(FIELD_ENTITIES),
      label: z
        .string()
        .optional()
        .describe("What a rep should see. Required when creating."),
      key: z
        .string()
        .optional()
        .describe("Which field to change. Required when updating a brief."),
      type: z.enum(FIELD_TYPES).optional().describe("Required when creating."),
      options: z
        .array(z.string())
        .optional()
        .describe("The fixed list, when the type is SELECT."),
      agentBrief: z
        .string()
        .optional()
        .describe(
          "What would count as an answer, and where to look. Empty means you work from the label and type alone.",
        ),
      agentFilled: z
        .boolean()
        .optional()
        .describe("False hands the field back to the rep entirely."),
    }),
    // A schema change every rep sees: the owner or admin in the conversation
    // approves it first, so nothing planted in a prompt changes fields
    // unseen.
    needsApproval: refusal(context) === null,
    execute: async (input) => {
      const refused = refusal(context);
      if (input.action === "create") {
        if (refused) return { created: false as const, reason: refused };
        if (!input.label || !input.type) {
          return {
            created: false as const,
            reason: "Creating a field needs both a label and a type.",
          };
        }
        const parsed = createFieldSchema.safeParse({
          entity: input.entity,
          label: input.label,
          type: input.type,
          options: (input.options ?? []).map((label) => ({ label })),
          agentBrief: input.agentBrief ?? null,
        });
        if (!parsed.success) {
          return {
            created: false as const,
            reason:
              parsed.error.issues[0]?.message ?? "That field is not valid.",
          };
        }
        try {
          return await FieldsService.create(
            context.organizationId,
            parsed.data,
          );
        } catch (error) {
          return { created: false as const, reason: rejection(error) };
        }
      }
      if (refused) return { updated: false as const, reason: refused };
      if (!input.key) {
        return {
          updated: false as const,
          reason: "Changing a brief needs the field key.",
        };
      }
      const field = await fieldByKey(context, input.entity, input.key, true);
      if (!field) {
        return {
          updated: false as const,
          reason: `There is no field called "${input.key}".`,
        };
      }
      const parsed = updateFieldSchema.safeParse({
        id: field.id,
        agentBrief: input.agentBrief ?? null,
        agentFilled: input.agentFilled,
      });
      if (!parsed.success) {
        return {
          updated: false as const,
          reason: parsed.error.issues[0]?.message ?? "That brief is not valid.",
        };
      }
      try {
        return await FieldsService.update(context.organizationId, parsed.data);
      } catch (error) {
        return { updated: false as const, reason: rejection(error) };
      }
    },
  }),

  archive_field: tool({
    description:
      "Archive a custom field. It leaves every sheet and table and stops being filled; the values already recorded are kept. A schema change every rep will see, so it needs a person.",
    inputSchema: z.object({
      entity: z.enum(FIELD_ENTITIES),
      key: z.string().describe("The field's key, as list_fields reports it."),
    }),
    // The owner or admin in the conversation approves it first.
    needsApproval: refusal(context) === null,
    execute: async ({ entity: fieldEntity, key }) => {
      const refused = refusal(context);
      if (refused) {
        return {
          archived: false as const,
          reason: context.attended
            ? refused
            : "Not something to do unattended. Say which field you would archive and let a rep do it from the Fields sheet.",
        };
      }
      const field = await fieldByKey(context, fieldEntity, key, true);
      if (!field) {
        return {
          archived: false as const,
          reason: `There is no field called "${key}".`,
        };
      }
      try {
        await FieldsService.archive(context.organizationId, field.id);
        return { archived: true as const };
      } catch (error) {
        return { archived: false as const, reason: rejection(error) };
      }
    },
  }),
});
