import {
  looksLikeSameCompany,
  nameMatchesLocalPart,
  sameDomain,
} from "./names";
import type { Person } from "./people";

// Whether a profile is the person behind a CRM email address, ported from the
// CRM's lib/identity.ts. Built to fail closed: the address on their own
// profile settles it alone; otherwise the employer and the name must both
// match, because one of them alone is a different person who happens to share
// something. Three checks, reported separately, so the agent records what it
// actually saw and the ledger prices it.

type IdentityClaim = {
  email: string;
  companyName: string;
  companyDomain: string;
};

type IdentityVerdict = {
  /** The profile lists the address we are identifying. */
  emailMatches: boolean;
  /** A current position is at the company we have them at. */
  employerMatches: boolean;
  /** The real name is a form of the address's local part. */
  nameMatches: boolean;
  isSamePerson: boolean;
  confidence: "high" | "medium" | "low";
};

export function verdictFor(
  person: Person,
  claim: IdentityClaim,
): IdentityVerdict {
  const local = claim.email.split("@")[0] ?? "";
  const emailMatches =
    person.email !== null &&
    person.email.trim().toLowerCase() === claim.email.trim().toLowerCase();
  const employerMatches = person.currentRoles.some(
    (role) =>
      sameDomain(role.organisation.domain, claim.companyDomain) ||
      looksLikeSameCompany(
        role.organisation.name ?? "",
        claim.companyName,
        claim.companyDomain,
      ),
  );
  const nameMatches = nameMatchesLocalPart(person, local);
  const isSamePerson = emailMatches || (employerMatches && nameMatches);
  return {
    emailMatches,
    employerMatches,
    nameMatches,
    isSamePerson,
    confidence: isSamePerson
      ? "high"
      : employerMatches || nameMatches
        ? "medium"
        : "low",
  };
}
