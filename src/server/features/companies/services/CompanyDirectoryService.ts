import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { CompanyDirectoryRepository } from "@/server/features/companies/repositories/CompanyDirectoryRepository";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { pokeEvents } from "@/server/features/team-agents/runtime/poke";
import type { RecordSource } from "@/shared/crm-enums";
import { domainFromEmail } from "@/shared/domain";

// The company a work email belongs to, as the CRM's company-directory.service
// keeps it: contacts added by hand or from captured mail and website forms
// are filed under the live company with their email's domain, which is added
// when there isn't one.

/**
 * The live company behind a work email's domain, added (named after the
 * domain, for the agent to research) when there isn't one; null for free
 * mail and machine senders. For contacts: `ownerId` is one the caller checked.
 * `source` says where an added company came from (mail capture's EMAIL or
 * CALENDAR).
 */
async function companyForEmail(
  organizationId: string,
  email: string,
  ownerId: string | null = null,
  source?: RecordSource,
): Promise<string | null> {
  const domain = domainFromEmail(email);
  if (!domain) return null;
  const existing = await CompanyDirectoryRepository.findLive(
    organizationId,
    domain,
  );
  if (existing) return existing.id;
  let id: string;
  try {
    id = await CompanyDirectoryRepository.create(
      {
        organizationId,
        name: domain,
        domain,
        website: `https://${domain}`,
        ownerId,
        source,
      },
      [{ type: "company.created", data: { name: domain, domain } }],
    );
  } catch (error) {
    // Another request added the domain first.
    const first = isUniqueViolation(error)
      ? await CompanyDirectoryRepository.findLive(organizationId, domain)
      : null;
    if (!first) throw error;
    return first.id;
  }
  pokeEvents(organizationId);
  await AgentTaskService.companyCreated(
    organizationId,
    id,
    `Created from an email domain (${domain}): it has no name but the domain`,
  );
  await FieldsService.queueFillForNewRecord(organizationId, "COMPANY", id);
  return id;
}

export const CompanyDirectoryService = { companyForEmail };
