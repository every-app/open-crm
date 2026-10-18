import { apiRoute } from "@/server/api/apiRoute";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { suppressDomainSchema } from "@/types/schemas/mailbox";

// The CRM's one Google endpoint with no screen behind it: suppressing a
// domain. Any member may, as in the CRM.

export const googleRoutes = [
  apiRoute({
    method: "POST",
    path: "/google/suppress-domain",
    tag: "Google",
    summary:
      "Stop filing a domain's people as contacts from mail, meetings and website forms; with `purge` (the default), also delete the threads and meetings filed on its company.",
    input: suppressDomainSchema,
    handler: (data, context) =>
      ConnectionService.suppressDomain(context.organizationId, data),
  }),
];
