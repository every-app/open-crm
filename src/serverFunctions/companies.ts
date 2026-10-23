import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  companyListSchema,
  companyOptionsSchema,
  createCompanySchema,
  setPrimaryContactSchema,
  updateCompanySchema,
} from "@/types/schemas/companies";
import {
  bulkIdsSchema,
  bulkOwnerSchema,
  recordIdSchema,
} from "@/types/schemas/records";

// Members work the pipeline: they add, edit, archive and restore companies.
// Deleting an archived company forever is for owners and admins.

export const listCompanies = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(companyListSchema)
  .handler(({ data, context }) =>
    CompanyService.listCompanies(context.organizationId, data),
  );

export const getCompany = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    CompanyService.getCompany(context.organizationId, data.id),
  );

export const companyOptions = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(companyOptionsSchema)
  .handler(({ data, context }) =>
    CompanyService.companyOptions(context.organizationId, data.q),
  );

export const createCompany = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createCompanySchema)
  .handler(({ data, context }) =>
    CompanyService.createCompany(context.organizationId, {
      ...data,
      ownerId: data.ownerId === undefined ? context.userId : data.ownerId,
    }),
  );

export const updateCompany = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(updateCompanySchema)
  .handler(({ data, context }) =>
    CompanyService.updateCompany(context.organizationId, data),
  );

export const archiveCompany = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    CompanyService.archiveCompany(context.organizationId, data.id),
  );

export const restoreCompany = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    CompanyService.restoreCompany(context.organizationId, data.id),
  );

export const purgeCompany = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { record: ["purge"] });
    return CompanyService.purgeCompany(context.organizationId, data.id);
  });

export const enrichCompany = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(recordIdSchema)
  .handler(({ data, context }) =>
    CompanyService.enrichCompany(context.organizationId, data.id),
  );

export const setPrimaryContact = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setPrimaryContactSchema)
  .handler(({ data, context }) =>
    CompanyService.setPrimaryContact(
      context.organizationId,
      data.companyId,
      data.contactId,
    ),
  );

export const bulkAssignCompanyOwner = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkOwnerSchema)
  .handler(({ data, context }) =>
    CompanyService.bulkAssignOwner(
      context.organizationId,
      data.ids,
      data.ownerId,
    ),
  );

export const bulkEnrichCompanies = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) =>
    CompanyService.bulkEnrich(context.organizationId, data.ids),
  );

export const bulkArchiveCompanies = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) =>
    CompanyService.bulkArchive(context.organizationId, data.ids),
  );

export const bulkRestoreCompanies = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) =>
    CompanyService.bulkRestore(context.organizationId, data.ids),
  );

export const bulkPurgeCompanies = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(bulkIdsSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { record: ["purge"] });
    return CompanyService.bulkPurge(context.organizationId, data.ids);
  });
