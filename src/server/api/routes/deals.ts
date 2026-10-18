import { requireOrgPermission } from "@/server/auth/org-gate";
import { apiRoute } from "@/server/api/apiRoute";
import { DealService } from "@/server/features/deals/services/DealService";
import {
  attachDealContactSchema,
  bulkDealOwnerSchema,
  bulkDealStageSchema,
  createDealSchema,
  dealContactOptionsSchema,
  dealContactRoleSchema,
  dealListSchema,
  detachDealContactSchema,
  setDealStageSchema,
  updateDealSchema,
} from "@/types/schemas/deals";
import { bulkIdsSchema, recordIdSchema } from "@/types/schemas/records";

// As in src/serverFunctions/deals.ts: members add, edit, move, archive and
// restore deals; deleting an archived deal forever is for owners and admins.

const tag = "Deals";

export const dealRoutes = [
  apiRoute({
    method: "POST",
    path: "/deals/search",
    tag,
    summary:
      "List deals: search, owner, status, stage, closing window, archived and custom field filters, sorting and paging, as the Deals list takes them. `facetCounts` counts the deals the search finds by each filter's values.",
    input: dealListSchema,
    handler: (data, context) =>
      DealService.listDeals(context.organizationId, data),
  }),
  apiRoute({
    method: "GET",
    path: "/deals/{id}",
    tag,
    summary: "One deal with its company, owner and the people on it.",
    input: recordIdSchema,
    handler: (data, context) =>
      DealService.getDeal(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/deals",
    tag,
    summary:
      "Add a deal at a company. Without a currency it is in the workspace's reporting currency.",
    input: createDealSchema,
    handler: (data, context) =>
      DealService.createDeal(context.organizationId, data),
  }),
  apiRoute({
    method: "PATCH",
    path: "/deals/{id}",
    tag,
    summary:
      "Change a deal. Only the fields given change; null clears the ones that may be empty. The stage moves with PATCH /deals/{id}/stage.",
    input: updateDealSchema,
    handler: (data, context) =>
      DealService.updateDeal(context.organizationId, data),
  }),
  apiRoute({
    method: "PATCH",
    path: "/deals/{id}/stage",
    tag,
    summary:
      "Move a deal to another stage; CLOSED_LOST and UNQUALIFIED_TO_BUY take a closedReason. The move goes on the deal's timeline.",
    input: setDealStageSchema,
    handler: (data, context) =>
      DealService.setStage(context.organizationId, data, context.userId),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/{id}/archive",
    tag,
    summary: "Archive a deal: it leaves every list and total until restored.",
    input: recordIdSchema,
    handler: (data, context) =>
      DealService.archiveDeal(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/{id}/restore",
    tag,
    summary: "Restore an archived deal.",
    input: recordIdSchema,
    handler: (data, context) =>
      DealService.restoreDeal(context.organizationId, data.id),
  }),
  apiRoute({
    method: "DELETE",
    path: "/deals/{id}",
    tag,
    summary: "Delete an archived deal forever (owners and admins).",
    input: recordIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return DealService.purgeDeal(context.organizationId, data.id);
    },
  }),
  apiRoute({
    method: "GET",
    path: "/deals/{dealId}/contact-options",
    tag,
    summary: "The live contacts at the deal's company who aren't on it yet.",
    input: dealContactOptionsSchema,
    handler: (data, context) =>
      DealService.contactOptions(context.organizationId, data.dealId),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/{dealId}/contacts",
    tag,
    summary:
      "Put someone who works at the deal's company on the deal, optionally with a role. Someone already on it keeps their role unless one is given.",
    input: attachDealContactSchema,
    handler: (data, context) =>
      DealService.attachContact(context.organizationId, data),
  }),
  apiRoute({
    method: "DELETE",
    path: "/deals/{dealId}/contacts/{contactId}",
    tag,
    summary: "Take someone off a deal. The contact stays in the CRM.",
    input: detachDealContactSchema,
    handler: (data, context) =>
      DealService.detachContact(
        context.organizationId,
        data.dealId,
        data.contactId,
      ),
  }),
  apiRoute({
    method: "PATCH",
    path: "/deals/{dealId}/contacts/{contactId}/role",
    tag,
    summary: "Set what someone does on a deal; null clears it.",
    input: dealContactRoleSchema,
    handler: (data, context) =>
      DealService.setContactRole(context.organizationId, data),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/bulk-assign-owner",
    tag,
    summary: "Give up to 100 deals to one member.",
    input: bulkDealOwnerSchema,
    handler: (data, context) =>
      DealService.bulkAssignOwner(
        context.organizationId,
        data.ids,
        data.ownerId,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/bulk-set-stage",
    tag,
    summary: "Move up to 100 deals to one stage.",
    input: bulkDealStageSchema,
    handler: (data, context) =>
      DealService.bulkSetStage(context.organizationId, data, context.userId),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/bulk-archive",
    tag,
    summary: "Archive up to 100 deals.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      DealService.bulkArchive(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/bulk-restore",
    tag,
    summary: "Restore up to 100 archived deals.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      DealService.bulkRestore(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/deals/bulk-purge",
    tag,
    summary: "Delete up to 100 archived deals forever (owners and admins).",
    input: bulkIdsSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return DealService.bulkPurge(context.organizationId, data.ids);
    },
  }),
];
