import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { DealService } from "@/server/features/deals/services/DealService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
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

// Members work the pipeline: they add, edit, move, archive and restore deals.
// Deleting an archived deal forever is for owners and admins.

export const listDeals = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(dealListSchema)
  .handler(({ data, context }) =>
    DealService.listDeals(context.organizationId, data),
  );

export const getDeal = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    DealService.getDeal(context.organizationId, data.id),
  );

export const createDeal = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createDealSchema)
  .handler(({ data, context }) =>
    DealService.createDeal(context.organizationId, data),
  );

export const updateDeal = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(updateDealSchema)
  .handler(({ data, context }) =>
    DealService.updateDeal(context.organizationId, data),
  );

export const setDealStage = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setDealStageSchema)
  .handler(({ data, context }) =>
    DealService.setStage(context.organizationId, data, context.userId),
  );

export const archiveDeal = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    DealService.archiveDeal(context.organizationId, data.id),
  );

export const restoreDeal = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    DealService.restoreDeal(context.organizationId, data.id),
  );

export const purgeDeal = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { record: ["purge"] });
    return DealService.purgeDeal(context.organizationId, data.id);
  });

export const dealContactOptions = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(dealContactOptionsSchema)
  .handler(({ data, context }) =>
    DealService.contactOptions(context.organizationId, data.dealId),
  );

export const attachDealContact = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(attachDealContactSchema)
  .handler(({ data, context }) =>
    DealService.attachContact(context.organizationId, data),
  );

export const detachDealContact = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(detachDealContactSchema)
  .handler(({ data, context }) =>
    DealService.detachContact(
      context.organizationId,
      data.dealId,
      data.contactId,
    ),
  );

export const setDealContactRole = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(dealContactRoleSchema)
  .handler(({ data, context }) =>
    DealService.setContactRole(context.organizationId, data),
  );

export const bulkAssignDealOwner = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkDealOwnerSchema)
  .handler(({ data, context }) =>
    DealService.bulkAssignOwner(context.organizationId, data.ids, data.ownerId),
  );

export const bulkSetDealStage = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkDealStageSchema)
  .handler(({ data, context }) =>
    DealService.bulkSetStage(context.organizationId, data, context.userId),
  );

export const bulkArchiveDeals = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) =>
    DealService.bulkArchive(context.organizationId, data.ids),
  );

export const bulkRestoreDeals = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) =>
    DealService.bulkRestore(context.organizationId, data.ids),
  );

export const bulkPurgeDeals = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { record: ["purge"] });
    return DealService.bulkPurge(context.organizationId, data.ids);
  });
