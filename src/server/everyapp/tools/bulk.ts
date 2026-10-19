import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { crmTool, memberId } from "@/server/everyapp/crm-tool";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { DealService } from "@/server/features/deals/services/DealService";
import { AppError } from "@/server/lib/errors";
import { DEAL_STAGES } from "@/shared/crm-enums";
import { errorCodeSchema } from "@/shared/error-codes";
import { RECORD_KINDS } from "@/shared/records";
import { bulkIdsSchema } from "@/types/schemas/records";

// The list's bulk actions, which also restore, enrich and delete one record
// (pass one id). Each says how many records it changed of how many it was
// given, and the code of the first failure. The same rules as the app's:
// anyone archives, restores and reassigns; only owners and admins delete
// forever.

const kind = z
  .enum(RECORD_KINDS)
  .describe("Which records: company, contact or deal.");

const ids = bulkIdsSchema.shape.ids.describe(
  "Up to 100 record ids, from the list tools.",
);

const bulkOutput = z.object({
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  error: errorCodeSchema
    .nullable()
    .describe(
      "Why the first one failed: NOT_FOUND, CONFLICT (say, not archived, or its domain or email taken), FORBIDDEN.",
    ),
  message: z
    .string()
    .nullable()
    .describe("The first refusal in words, when there is one."),
});

const SERVICES = {
  company: {
    archive: CompanyService.bulkArchive,
    restore: CompanyService.bulkRestore,
    purge: CompanyService.bulkPurge,
  },
  contact: {
    archive: ContactService.bulkArchive,
    restore: ContactService.bulkRestore,
    purge: ContactService.bulkPurge,
  },
  deal: {
    archive: DealService.bulkArchive,
    restore: DealService.bulkRestore,
    purge: DealService.bulkPurge,
  },
};

export const bulkTools = {
  bulk_archive: crmTool({
    description:
      "Archive up to 100 companies, contacts or deals: they leave every list and total until bulk_restore brings them back.",
    risk: "write",
    input: z.object({ kind, ids }).strict(),
    output: bulkOutput,
    handler: (input, context) =>
      SERVICES[input.kind].archive(context.organizationId, input.ids),
  }),

  bulk_restore: crmTool({
    description:
      "Restore up to 100 archived companies, contacts or deals (list them with archived: true).",
    risk: "write",
    input: z.object({ kind, ids }).strict(),
    output: bulkOutput,
    handler: (input, context) =>
      SERVICES[input.kind].restore(context.organizationId, input.ids),
  }),

  bulk_purge: crmTool({
    description:
      "Delete up to 100 archived companies, contacts or deals forever (owners and admins only). One that isn't archived fails and is left alone.",
    risk: "destructive",
    input: z.object({ kind, ids }).strict(),
    output: bulkOutput,
    handler: async (input, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return SERVICES[input.kind].purge(context.organizationId, input.ids);
    },
  }),

  bulk_assign_owner: crmTool({
    description:
      "Give up to 100 companies, contacts or deals to one member, by email. null leaves companies and contacts with nobody; a deal always has an owner.",
    risk: "write",
    input: z
      .object({
        kind,
        ids,
        ownerEmail: z
          .string()
          .email()
          .nullable()
          .describe("The new owner's email, or null for nobody."),
      })
      .strict(),
    output: bulkOutput,
    handler: async (input, context) => {
      const ownerId =
        input.ownerEmail === null
          ? null
          : await memberId(context.organizationId, input.ownerEmail);
      switch (input.kind) {
        case "company":
          return CompanyService.bulkAssignOwner(
            context.organizationId,
            input.ids,
            ownerId,
          );
        case "contact":
          return ContactService.bulkAssignOwner(
            context.organizationId,
            input.ids,
            ownerId,
          );
        case "deal":
          if (!ownerId) {
            throw new AppError("VALIDATION_ERROR", "A deal needs an owner.");
          }
          return DealService.bulkAssignOwner(
            context.organizationId,
            input.ids,
            ownerId,
          );
      }
    },
  }),

  bulk_enrich: crmTool({
    description:
      "Ask the research agent to research up to 100 companies or contacts again. It costs the organization credits and works in the background (get_enrichment_queue).",
    risk: "write",
    input: z
      .object({
        kind: z
          .enum(["company", "contact"])
          .describe("Which records: company or contact."),
        ids,
      })
      .strict(),
    output: bulkOutput,
    handler: (input, context) =>
      input.kind === "company"
        ? CompanyService.bulkEnrich(context.organizationId, input.ids)
        : ContactService.bulkEnrich(context.organizationId, input.ids),
  }),

  bulk_set_deal_stage: crmTool({
    description: `Move up to 100 deals to one stage; each move goes on its deal's timeline. CLOSED_LOST and UNQUALIFIED_TO_BUY take a closedReason. Stages: ${DEAL_STAGES.join(", ")}.`,
    risk: "write",
    input: z
      .object({
        ids,
        stage: z.enum(DEAL_STAGES),
        closedReason: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .describe("Why they were lost, or why they aren't a fit."),
      })
      .strict(),
    output: bulkOutput,
    handler: (input, context) =>
      DealService.bulkSetStage(context.organizationId, input, context.userId),
  }),

  bulk_set_contact_company: crmTool({
    description:
      "Move up to 100 contacts to one company, or take them off theirs with null.",
    risk: "write",
    input: z
      .object({
        ids,
        companyId: z
          .string()
          .min(1)
          .nullable()
          .describe("The company's id, from list_companies, or null."),
      })
      .strict(),
    output: bulkOutput,
    handler: (input, context) =>
      ContactService.bulkSetCompany(
        context.organizationId,
        input.ids,
        input.companyId,
      ),
  }),
};
