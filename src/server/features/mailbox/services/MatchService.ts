import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { CaptureWriteRepository } from "@/server/features/mailbox/repositories/CaptureWriteRepository";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import {
  dominantDomain,
  externalParticipants,
  isDerivedName,
  splitName,
  type ExternalFilterOptions,
  type Participant,
} from "@/shared/participants";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { domainFromEmail, normalizeDomain } from "@/shared/domain";

// Which records a thread or a meeting is filed on, ported from the CRM's
// MailboxMatchService. In order: a contact with one of the people's
// addresses; else the company behind the people's dominant work domain;
// else, only when the source may add records, a new company (named after the
// domain, for the agent to research) and the person as its contact. Nobody
// in `externalParticipants`' discard pile is ever matched or created.

export type MatchContext = ExternalFilterOptions;

type CaptureSource = "EMAIL" | "CALENDAR";

type MatchRequest = {
  participants: readonly Participant[];
  allowCreate: boolean;
  source: CaptureSource;
  /** The member whose mailbox it is: the owner of anything created. */
  ownerId: string;
};

type MatchResult = { companyId: string | null; contactId: string | null };

const NO_MATCH: MatchResult = { companyId: null, contactId: null };

/**
 * Who "we" are for one organization, as the CRM's internalIdentity: its
 * members' addresses and the mailboxes they connected, their work domains
 * (never a free-mail one) and the workspace's website. Website forms and
 * suppressing a domain count the same domains as our own.
 */
async function internalIdentity(organizationId: string) {
  const [members, mailboxes, workspace] = await Promise.all([
    AuthRepository.listMembers(organizationId),
    ConnectionRepository.accountEmails(organizationId),
    WorkspaceRepository.getOrCreate(organizationId),
  ]);
  const ourAddresses = new Set<string>();
  const ourDomains = new Set<string>();
  const website = normalizeDomain(workspace.website);
  if (website) ourDomains.add(website);
  for (const email of [
    ...members.map((member) => member.email),
    ...mailboxes,
  ]) {
    const address = email.toLowerCase();
    ourAddresses.add(address);
    const domain = domainFromEmail(address);
    if (domain) ourDomains.add(domain);
  }
  return { ourAddresses, ourDomains };
}

/** Who "we" are, plus what people suppressed. */
async function loadContext(organizationId: string): Promise<MatchContext> {
  const [ours, suppressed] = await Promise.all([
    internalIdentity(organizationId),
    CaptureWriteRepository.suppressions(organizationId),
  ]);
  return {
    ...ours,
    suppressedEmails: suppressed.emails,
    suppressedDomains: suppressed.domains,
  };
}

async function resolve(
  organizationId: string,
  request: MatchRequest,
  context: MatchContext,
): Promise<MatchResult> {
  const external = externalParticipants(request.participants, context);
  if (external.length === 0) return NO_MATCH;

  const known = await CaptureWriteRepository.contactByEmails(
    organizationId,
    external.map((person) => person.email),
  );
  if (known) return { companyId: known.companyId, contactId: known.id };

  const domains = [
    ...new Set(
      external.flatMap((person) => {
        const domain = domainFromEmail(person.email);
        return domain ? [domain] : [];
      }),
    ),
  ];
  const companies = await CaptureWriteRepository.companiesByDomain(
    organizationId,
    domains,
  );
  const domain = dominantDomain(external, new Set(companies.keys()));
  if (!domain) return NO_MATCH;

  const existing = companies.get(domain);
  if (existing) {
    return {
      companyId: existing,
      contactId: request.allowCreate
        ? await createContact(
            organizationId,
            external,
            domain,
            existing,
            request,
          )
        : null,
    };
  }
  if (!request.allowCreate) return NO_MATCH;

  const lead =
    external.find((person) => domainFromEmail(person.email) === domain) ??
    external[0];
  if (!lead) return NO_MATCH;
  const companyId = await CompanyService.companyForEmail(
    organizationId,
    lead.email,
    request.ownerId,
    request.source,
  );
  if (!companyId) return NO_MATCH;
  await ActivityRepository.insert({
    organizationId,
    type: "ENRICHMENT",
    subject: "Company added from your inbox",
    body: `Created because you ${request.source === "CALENDAR" ? "met" : "emailed"} someone at ${domain}.`,
    occurredAt: new Date().toISOString(),
    dueAt: null,
    companyId,
    contactId: null,
    dealId: null,
    createdById: request.ownerId,
    meta: { source: request.source, domain, automated: true },
  });
  console.log("[mailbox] company added from a mailbox", {
    organizationId,
    companyId,
    source: request.source,
  });
  return {
    companyId,
    contactId: await createContact(
      organizationId,
      external,
      domain,
      companyId,
      request,
    ),
  };
}

/**
 * The person at `domain` as a contact of the company: the live contact with
 * their address, or a new one. A name the mail carries replaces one only
 * made from the address; a new contact with no name at all is the agent's
 * to identify.
 */
async function createContact(
  organizationId: string,
  external: Participant[],
  domain: string,
  companyId: string,
  request: MatchRequest,
): Promise<string | null> {
  const person = external.find(
    (candidate) => domainFromEmail(candidate.email) === domain,
  );
  if (!person) return null;
  const { firstName, lastName } = splitName(person.name, person.email);

  let contact = await ContactRepository.findLiveByEmail(
    organizationId,
    person.email,
  );
  let created = false;
  if (!contact) {
    try {
      const id = await ContactRepository.insert({
        organizationId,
        firstName,
        lastName,
        email: person.email,
        phone: null,
        title: null,
        companyId,
        ownerId: request.ownerId,
        source: request.source,
      });
      contact = { id, firstName, lastName };
      created = true;
    } catch (error) {
      // Another check added them first.
      if (!isUniqueViolation(error)) throw error;
      contact = await ContactRepository.findLiveByEmail(
        organizationId,
        person.email,
      );
      if (!contact) return null;
    }
  }

  if (created) {
    await ActivityRepository.insert({
      organizationId,
      type: "ENRICHMENT",
      subject: "Contact added from your inbox",
      body: `${person.email} appeared in a ${request.source === "CALENDAR" ? "meeting" : "thread"}.`,
      occurredAt: new Date().toISOString(),
      dueAt: null,
      companyId,
      contactId: contact.id,
      dealId: null,
      createdById: request.ownerId,
      meta: { source: request.source, automated: true },
    });
    await FieldsService.queueFillForNewRecord(
      organizationId,
      "CONTACT",
      contact.id,
    );
  }

  const hasRealName = Boolean(person.name?.trim());
  const placeholder = isDerivedName(
    person.email,
    contact.firstName,
    contact.lastName,
  );
  if (hasRealName && placeholder) {
    await ContactRepository.update(organizationId, contact.id, {
      firstName,
      lastName,
    });
  } else if (created && placeholder) {
    await AgentTaskService.contactCreated(
      organizationId,
      contact.id,
      "Created by the sync from an address, with no name on it",
    );
  }
  return contact.id;
}

export const MatchService = { context: loadContext, internalIdentity, resolve };
