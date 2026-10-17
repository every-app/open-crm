import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import {
  TrackingEventRepository,
  type TouchColumns,
} from "@/server/features/tracking/repositories/TrackingEventRepository";
import {
  CONTACTS_PER_HOUR,
  hourWindow,
} from "@/server/features/tracking/trackingRules";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import {
  isMachineDomain,
  normalizeDomain,
  normalizeEmail,
} from "@/shared/domain";
import {
  isAutomatedAddress,
  isMachineAddress,
  splitName,
} from "@/shared/participants";

// The only path from a website form to a contact. Every submission is
// stored; filing it may decline, and the reason is kept on the row. It
// applies the rules captured mail does (machine and automated addresses, the
// organization's own domain, deleted contacts and suppressed domains stay
// out), bounds a scripted form's damage with CONTACTS_PER_HOUR, and tells the
// research agent about a new contact without asking it anything.

type Submission = {
  id: string;
  email: string | null;
  name: string | null;
  host: string;
  path: string;
  visitorId: string;
  firstTouch: TouchColumns;
  lastTouch: TouchColumns;
};

type Outcome =
  | { filed: true; contactId: string }
  | { filed: false; reason: string };

const CONTACT_CAP_REASON = "Hourly contact cap reached: not filed";

async function skip(
  organizationId: string,
  submissionId: string,
  reason: string,
): Promise<Outcome> {
  await TrackingEventRepository.skipSubmission(
    organizationId,
    submissionId,
    reason,
  );
  return { filed: false, reason };
}

function ownDomain(website: string | null, domain: string): boolean {
  const own = normalizeDomain(website);
  return own !== null && (domain === own || domain.endsWith(`.${own}`));
}

async function suppression(
  organizationId: string,
  email: string,
  domain: string,
): Promise<string | null> {
  const found = await TrackingEventRepository.suppression(
    organizationId,
    email,
    domain,
  );
  if (found.address) return "This address was deleted by a person";
  if (found.domain) return "This domain is suppressed";
  return null;
}

/**
 * Claims the submission for the contact, then leaves the note and ties the
 * visitor to them. A caller that loses the claim (a second delivery of the
 * same submission) writes nothing, so the contact gets one note.
 */
async function attach(
  organizationId: string,
  submission: Submission,
  contactId: string,
) {
  const claimed = await TrackingEventRepository.claimSubmission(
    organizationId,
    submission.id,
    contactId,
  );
  if (!claimed) return;
  await ActivityRepository.insert({
    organizationId,
    type: "NOTE",
    subject: `Submitted a form on ${submission.host}`,
    body: `${submission.host}${submission.path}`,
    occurredAt: new Date().toISOString(),
    dueAt: null,
    companyId: null,
    contactId,
    dealId: null,
    createdById: null,
    meta: { automated: true, source: "tracking" },
  });
  await TrackingEventRepository.identifyVisitor(
    organizationId,
    submission.visitorId,
    contactId,
    { first: submission.firstTouch, last: submission.lastTouch },
  );
}

async function file(
  organizationId: string,
  submission: Submission,
): Promise<Outcome> {
  const email = normalizeEmail(submission.email);
  if (!email) return skip(organizationId, submission.id, "No email address");
  if (isMachineAddress(email) || isAutomatedAddress(email)) {
    return skip(organizationId, submission.id, "Not an address a person reads");
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (isMachineDomain(domain)) {
    return skip(organizationId, submission.id, "Not a domain a person reads");
  }
  const workspace = await WorkspaceRepository.getOrCreate(organizationId);
  if (ownDomain(workspace.website, domain)) {
    return skip(organizationId, submission.id, "One of our own addresses");
  }
  const suppressed = await suppression(organizationId, email, domain);
  if (suppressed) return skip(organizationId, submission.id, suppressed);

  // Somebody already in the CRM costs nothing against the cap.
  const existing = await ContactRepository.findLiveByEmail(
    organizationId,
    email,
  );
  if (existing) {
    await attach(organizationId, submission, existing.id);
    return { filed: true, contactId: existing.id };
  }

  const window = hourWindow(new Date());
  const capKey = `contacts:${window.key}`;
  if (
    !(await TrackingEventRepository.take(
      organizationId,
      capKey,
      CONTACTS_PER_HOUR,
      1,
      window.expiresAt,
    ))
  ) {
    return skip(organizationId, submission.id, CONTACT_CAP_REASON);
  }

  const { firstName, lastName } = splitName(submission.name, email);
  let contactId: string;
  try {
    contactId = await ContactRepository.insert({
      organizationId,
      firstName,
      lastName,
      email,
      phone: null,
      title: null,
      companyId: await CompanyService.companyForEmail(organizationId, email),
      ownerId: null,
      source: "TRACKING",
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another submission for this address created them first: hand the
    // slot back and file under theirs.
    await TrackingEventRepository.release(organizationId, capKey, 1);
    const raced = await ContactRepository.findLiveByEmail(
      organizationId,
      email,
    );
    if (!raced) throw error;
    await attach(organizationId, submission, raced.id);
    return { filed: true, contactId: raced.id };
  }

  await attach(organizationId, submission, contactId);
  console.log("[tracking] contact filed from a form", {
    organizationId,
    contactId,
    host: submission.host,
  });
  await AgentTaskService.contactCreated(
    organizationId,
    contactId,
    `Submitted a form on ${submission.host}`,
  );
  await FieldsService.queueFillForNewRecord(
    organizationId,
    "CONTACT",
    contactId,
  );
  return { filed: true, contactId };
}

export const TrackingFilingService = { file };
