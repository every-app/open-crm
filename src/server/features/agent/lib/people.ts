import { z } from "zod";

// A person as Context.dev reads them back from a profile they hold, ported
// from the CRM's lib/people.ts. Self-reported, and so authoritative on
// identity: their real name, their roles with dates, their education.

/** Context.dev ties a profile to a person only above this score. */
const MATCH_FLOOR = 70;

/** Where a photograph Context.dev hands back may come from. */
const AVATAR_HOSTS = ["brand.dev", "context.dev", "licdn.com"];

type Organisation = { name: string | null; domain: string | null };

type Role = {
  title: string | null;
  organisation: Organisation;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  description: string | null;
  isCurrent: boolean;
};

type Study = {
  institution: Organisation;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type Person = {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  bio: string | null;
  location: string | null;
  email: string | null;
  photoUrl: string | null;
  profileUrl: string | null;
  socialUrls: string[];
  websiteUrls: string[];
  skills: string[];
  currentRoles: Role[];
  experience: Role[];
  education: Study[];
};

export type PersonMatch =
  | { outcome: "found"; person: Person }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string; retryable: boolean };

const text = z.string().trim().min(1).nullable().catch(null);
const list = z.array(text).catch([]);
const organisation = z
  .object({ name: text, domain: text })
  .catch({ name: null, domain: null });
const partialDate = z
  .object({
    year: z.number(),
    month: z.number().nullable().catch(null),
    day: z.number().nullable().catch(null),
  })
  .nullable()
  .catch(null);
const roleShape = z.object({
  title: text,
  organization: organisation,
  start_date: partialDate,
  end_date: partialDate,
  location: text,
  description: text,
  is_current: z.boolean().nullable().catch(null),
});
const EMPTY_ROLE: z.infer<typeof roleShape> = {
  title: null,
  organization: { name: null, domain: null },
  start_date: null,
  end_date: null,
  location: null,
  description: null,
  is_current: null,
};
const educationShape = z.object({
  institution: organisation,
  degree: text,
  field_of_study: text,
  start_date: partialDate,
  end_date: partialDate,
});
const EMPTY_EDUCATION: z.infer<typeof educationShape> = {
  institution: { name: null, domain: null },
  degree: null,
  field_of_study: null,
  start_date: null,
  end_date: null,
};
const personShape = z.object({
  name: z
    .object({ first: text, last: text, full: text })
    .catch({ first: null, last: null, full: null }),
  email: text,
  avatar_url: text,
  bio: text,
  location: z
    .object({ display: text, city: text, region: text, country: text })
    .catch({ display: null, city: null, region: null, country: null }),
  social_urls: list,
  website_urls: list,
  skills: list,
  current_role: roleShape.nullable().catch(null),
  experience: z.array(roleShape.catch(EMPTY_ROLE)).catch([]),
  education: z.array(educationShape.catch(EMPTY_EDUCATION)).catch([]),
});
const candidateShape = z.object({
  status: z.literal("candidate"),
  score: z.number(),
  person: personShape,
});

/** A Context.dev people match, refused below the floor. */
export function personFromMatch(match: unknown): PersonMatch {
  const candidate = candidateShape.safeParse(match);
  if (!candidate.success) {
    return { outcome: "skipped", reason: "No person matched that profile." };
  }
  if (candidate.data.score < MATCH_FLOOR) {
    return {
      outcome: "skipped",
      reason:
        "Context could not tie a person to that profile firmly enough to be worth reading.",
    };
  }
  return { outcome: "found", person: toPerson(candidate.data.person) };
}

const present = (items: (string | null)[]): string[] =>
  items.flatMap((item) => (item ? [item] : []));

function toPerson(raw: z.infer<typeof personShape>): Person {
  const socialUrls = present(raw.social_urls);
  const current = raw.current_role ? [toRole(raw.current_role)] : [];
  const experience = raw.experience.map(toRole);
  const place = [raw.location.city, raw.location.region, raw.location.country]
    .filter(Boolean)
    .join(", ");
  return {
    firstName: raw.name.first,
    lastName: raw.name.last,
    fullName: raw.name.full,
    bio: raw.bio,
    location: raw.location.display ?? (place || null),
    email: raw.email,
    photoUrl: photoUrl(raw.avatar_url),
    profileUrl:
      socialUrls.find((url) => slugFromProfileUrl(url) !== null) ?? null,
    socialUrls,
    websiteUrls: present(raw.website_urls),
    skills: present(raw.skills),
    currentRoles: current.concat(
      experience.filter(
        (role) =>
          role.isCurrent && !current.some((held) => sameRole(held, role)),
      ),
    ),
    experience,
    education: raw.education.map((study) => ({
      institution: study.institution,
      degree: study.degree,
      fieldOfStudy: study.field_of_study,
      startDate: dateOf(study.start_date),
      endDate: dateOf(study.end_date),
    })),
  };
}

function sameRole(held: Role, role: Role): boolean {
  return (
    held.organisation.name === role.organisation.name &&
    held.title === role.title &&
    held.startDate === role.startDate &&
    held.endDate === role.endDate
  );
}

function toRole(raw: z.infer<typeof roleShape>): Role {
  return {
    title: raw.title,
    organisation: raw.organization,
    startDate: dateOf(raw.start_date),
    endDate: dateOf(raw.end_date),
    location: raw.location,
    description: raw.description,
    isCurrent: raw.is_current ?? raw.end_date === null,
  };
}

function dateOf(date: z.infer<typeof partialDate>): string | null {
  if (!date) return null;
  const year = String(date.year).padStart(4, "0");
  if (date.month === null) return year;
  const month = String(date.month).padStart(2, "0");
  if (date.day === null) return `${year}-${month}`;
  return `${year}-${month}-${String(date.day).padStart(2, "0")}`;
}

/** An https photograph from a host Context.dev serves avatars from, or null. */
function photoUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const trusted = AVATAR_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    return trusted ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The handle of a personal LinkedIn profile URL, or null. One typed without
 * its scheme ("linkedin.com/in/jane") is the same profile, as the CRM's
 * linkedinSlug read it.
 */
export function slugFromProfileUrl(raw: string | null): string | null {
  const typed = raw?.trim();
  if (!typed) return null;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`,
    );
    const host = url.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const [section, slug] = url.pathname.split("/").filter(Boolean);
    if (section !== "in" || !slug) return null;
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

/** The profile URL for a LinkedIn handle, as Context.dev is asked for it. */
export function profileUrlFor(slug: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(slug.trim())}`;
}
