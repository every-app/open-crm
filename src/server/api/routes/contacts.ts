import { requireOrgPermission } from "@/server/auth/org-gate";
import { apiRoute } from "@/server/api/apiRoute";
import { ContactFactService } from "@/server/features/contacts/services/ContactFactService";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import {
  bulkContactCompanySchema,
  contactListSchema,
  createContactSchema,
  decideFactSchema,
  updateContactSchema,
} from "@/types/schemas/contacts";
import {
  bulkIdsSchema,
  bulkOwnerSchema,
  recordIdSchema,
} from "@/types/schemas/records";

// As in src/serverFunctions/contacts.ts: members add, edit, archive and
// restore contacts and settle the agent's suggestions; deleting an archived
// contact forever is for owners and admins.

const tag = "Contacts";

export const contactRoutes = [
  apiRoute({
    method: "POST",
    path: "/contacts/search",
    tag,
    summary:
      "List contacts: search, owner, company, title, seniority, persona, activity, archived and custom field filters, sorting and paging, as the Contacts list takes them.",
    input: contactListSchema,
    handler: (data, context) =>
      ContactService.listContacts(context.organizationId, data),
  }),
  apiRoute({
    method: "GET",
    path: "/contacts/{id}",
    tag,
    summary:
      "One contact with their company, deals, colleagues and the agent's open suggestions.",
    input: recordIdSchema,
    handler: (data, context) =>
      ContactService.getContact(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts",
    tag,
    summary:
      "Add a contact. Left without a company, a work email files them at its company.",
    input: createContactSchema,
    handler: (data, context) =>
      ContactService.createContact(context.organizationId, data),
  }),
  apiRoute({
    method: "PATCH",
    path: "/contacts/{id}",
    tag,
    summary:
      "Change a contact. Only the fields given change; an empty string clears a text field.",
    input: updateContactSchema,
    handler: (data, context) =>
      ContactService.updateContact(context.organizationId, data),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/{id}/archive",
    tag,
    summary: "Archive a contact: they leave every list until restored.",
    input: recordIdSchema,
    handler: (data, context) =>
      ContactService.archiveContact(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/{id}/restore",
    tag,
    summary: "Restore an archived contact.",
    input: recordIdSchema,
    handler: (data, context) =>
      ContactService.restoreContact(context.organizationId, data.id),
  }),
  apiRoute({
    method: "DELETE",
    path: "/contacts/{id}",
    tag,
    summary: "Delete an archived contact forever (owners and admins).",
    input: recordIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return ContactService.purgeContact(context.organizationId, data.id);
    },
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/{id}/enrich",
    tag,
    summary: "Ask the research agent to look the contact up again.",
    input: recordIdSchema,
    handler: (data, context) =>
      ContactService.enrichContact(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/decide-fact",
    tag,
    summary:
      "Accept or dismiss one of the agent's suggestions about a contact.",
    input: decideFactSchema,
    handler: (data, context) =>
      ContactFactService.decideFact(
        context.organizationId,
        context.userId,
        data,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/bulk-assign-owner",
    tag,
    summary: "Give up to 100 contacts to one member; null for nobody.",
    input: bulkOwnerSchema,
    handler: (data, context) =>
      ContactService.bulkAssignOwner(
        context.organizationId,
        data.ids,
        data.ownerId,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/bulk-set-company",
    tag,
    summary: "Move up to 100 contacts to one company; null for none.",
    input: bulkContactCompanySchema,
    handler: (data, context) =>
      ContactService.bulkSetCompany(
        context.organizationId,
        data.ids,
        data.companyId,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/bulk-enrich",
    tag,
    summary: "Ask the research agent to look up to 100 contacts up again.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      ContactService.bulkEnrich(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/bulk-archive",
    tag,
    summary: "Archive up to 100 contacts.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      ContactService.bulkArchive(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/bulk-restore",
    tag,
    summary: "Restore up to 100 archived contacts.",
    input: bulkIdsSchema,
    handler: (data, context) =>
      ContactService.bulkRestore(context.organizationId, data.ids),
  }),
  apiRoute({
    method: "POST",
    path: "/contacts/bulk-purge",
    tag,
    summary: "Delete up to 100 archived contacts forever (owners and admins).",
    input: bulkIdsSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return ContactService.bulkPurge(context.organizationId, data.ids);
    },
  }),
];
