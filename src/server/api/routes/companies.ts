import { requireOrgPermission } from "@/server/auth/org-gate";
import { apiRoute } from "@/server/api/apiRoute";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
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

// As in src/serverFunctions/companies.ts: members add, edit, archive and
// restore companies; deleting an archived one forever is for owners and
// admins.

const tag = "Companies";

export const companyRoutes = [
  apiRoute({
    method: "POST",
    path: "/companies/search",
    tag,
    summary:
      "List companies: search, owner, industry, enrichment, activity, archived and custom field filters, sorting and paging, as the Companies list takes them.",
    input: companyListSchema,
    handler: (data, context) =>
      CompanyService.listCompanies(context.organizationId, data),
  }),
  apiRoute({
    method: "GET",
    path: "/companies/options",
    tag,
    summary: "Live companies whose name or domain matches `q`, for pickers.",
    input: companyOptionsSchema,
    handler: (data, context) =>
      CompanyService.companyOptions(context.organizationId, data.q),
  }),
  apiRoute({
    method: "GET",
    path: "/companies/{id}",
    tag,
    summary: "One company with its owner, primary contact, people and deals.",
    input: recordIdSchema,
    handler: (data, context) =>
      CompanyService.getCompany(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/companies",
    tag,
    summary:
      "Add a company. The domain must not belong to another live company; the research agent then profiles it.",
    input: createCompanySchema,
    handler: (data, context) =>
      CompanyService.createCompany(context.organizationId, data),
  }),
  apiRoute({
    method: "PATCH",
    path: "/companies/{id}",
    tag,
    summary:
      "Change a company. Only the fields given change; an empty string clears a text field.",
    input: updateCompanySchema,
    handler: (data, context) =>
      CompanyService.updateCompany(context.organizationId, data),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/{id}/archive",
    tag,
    summary: "Archive a company: it leaves every list until it is restored.",
    input: recordIdSchema,
    handler: (data, context) =>
      CompanyService.archiveCompany(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/{id}/restore",
    tag,
    summary: "Restore an archived company.",
    input: recordIdSchema,
    handler: (data, context) =>
      CompanyService.restoreCompany(context.organizationId, data.id),
  }),
  apiRoute({
    method: "DELETE",
    path: "/companies/{id}",
    tag,
    summary:
      "Delete an archived company forever (owners and admins). Its people stay, without a company.",
    input: recordIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return CompanyService.purgeCompany(context.organizationId, data.id);
    },
  }),
  apiRoute({
    method: "POST",
    path: "/companies/{id}/enrich",
    tag,
    summary: "Ask the research agent to profile the company again.",
    input: recordIdSchema,
    handler: (data, context) =>
      CompanyService.enrichCompany(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/{companyId}/set-primary-contact",
    tag,
    summary:
      "Make someone who works at the company its primary contact; null clears it.",
    input: setPrimaryContactSchema,
    handler: (data, context) =>
      CompanyService.setPrimaryContact(
        context.organizationId,
        data.companyId,
        data.contactId,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/bulk-assign-owner",
    tag,
    summary: "Give up to 100 companies to one member; null for nobody.",
    input: bulkOwnerSchema,
    handler: (data, context) =>
      CompanyService.bulkAssignOwner(
        context.organizationId,
        data.ids,
        data.ownerId,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/bulk-enrich",
    tag,
    summary: "Ask the research agent to profile up to 100 companies again.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      CompanyService.bulkEnrich(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/bulk-archive",
    tag,
    summary: "Archive up to 100 companies.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      CompanyService.bulkArchive(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/bulk-restore",
    tag,
    summary: "Restore up to 100 archived companies.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      CompanyService.bulkRestore(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/companies/bulk-purge",
    tag,
    summary: "Delete up to 100 archived companies forever (owners and admins).",
    input: bulkIdsSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return CompanyService.bulkPurge(context.organizationId, data.ids);
    },
  }),
];
