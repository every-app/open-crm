import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { EnrichmentService } from "@/server/features/enrichment/services/EnrichmentService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  enrichRecordsSchema,
  setEnrichmentProviderSchema,
} from "@/types/schemas/enrichment";

// Any member enriches the records they select. Which provider does it is the
// workspace's choice, made by owners and admins.

export const getEnrichmentSettings = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) =>
    EnrichmentService.getSettings(context.organizationId),
  );

export const setEnrichmentProvider = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setEnrichmentProviderSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return EnrichmentService.setPreferred(
      context.organizationId,
      data.kind,
      data.provider,
    );
  });

export const enrichContacts = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(enrichRecordsSchema)
  .handler(({ data, context }) =>
    EnrichmentService.enrichContacts(context, data.ids),
  );

export const enrichCompanies = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(enrichRecordsSchema)
  .handler(({ data, context }) =>
    EnrichmentService.enrichCompanies(context, data.ids),
  );
