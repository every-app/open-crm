import { z } from "zod";
import {
  linkedinHandle,
  linkedinProfileUrl,
  urlOnHost,
  type CompanyClues,
  type CompanyFacts,
  type Lookup,
  type PersonClues,
  type PersonFacts,
} from "./facts";
import type { ProviderFetch } from "./gateway";
import { failureReason, postJson, type Answer } from "./http";

// Context.dev: a company's brand by its domain (logo, colours, industry,
// location, socials), and a person read back from their LinkedIn profile or
// matched on the address, name and employer the CRM holds. The one provider
// with pictures: a person's photograph and a company's logos.

const API = "https://api.context.dev/v1";
const NAME = "Context.dev";
/** Context.dev waits this long on a slow site before it gives up. */
const LOOKUP_TIMEOUT_MS = 45_000;

/** Context.dev ties a profile to a person only above this score. */
const MATCH_FLOOR = 70;

/** Where a photograph Context.dev hands back may come from. */
const PHOTO_HOSTS = ["brand.dev", "context.dev", "licdn.com"];

const text = z.string().trim().min(1).nullable().catch(null);
const hex = z.object({ hex: text }).catch({ hex: null });

const brandSchema = z.object({
  title: text,
  description: text,
  slogan: text,
  email: text,
  phone: text,
  colors: z.array(hex).catch([]),
  logos: z
    .array(
      z
        .object({
          url: text,
          mode: text,
          type: text,
          colors: z.array(hex).catch([]),
        })
        .catch({ url: null, mode: null, type: null, colors: [] }),
    )
    .catch([]),
  socials: z
    .array(z.object({ type: text, url: text }).catch({ type: null, url: null }))
    .catch([]),
  address: z
    .object({ city: text, state_code: text, country: text, country_code: text })
    .nullable()
    .catch(null),
  industries: z
    .object({
      eic: z
        .array(
          z
            .object({ industry: text, subindustry: text })
            .catch({ industry: null, subindustry: null }),
        )
        .catch([]),
    })
    .nullable()
    .catch(null),
  links: z.object({ pricing: text, careers: text }).nullable().catch(null),
});
type Brand = z.infer<typeof brandSchema>;
type Logo = Brand["logos"][number];

const personSchema = z.object({
  status: z.literal("candidate"),
  score: z.number(),
  person: z.object({
    avatar_url: text,
    social_urls: z.array(text).catch([]),
    current_role: z.object({ title: text }).nullable().catch(null),
  }),
});

const errorCode = z
  .object({ error_code: z.string().optional().catch(undefined) })
  .catch({});

function post(
  fetcher: ProviderFetch,
  path: string,
  body: Record<string, unknown>,
) {
  return postJson(fetcher, `${API}${path}`, {
    ...body,
    timeoutOpts: { milliseconds: LOOKUP_TIMEOUT_MS, behavior: "fail" },
  });
}

async function company(
  fetcher: ProviderFetch,
  clues: CompanyClues,
): Promise<Lookup<CompanyFacts>> {
  if (!clues.domain) {
    return {
      outcome: "skipped",
      reason: "No domain to look up. Add the company's website first.",
    };
  }
  const answer = await post(fetcher, "/brand/retrieve", {
    type: "by_domain",
    domain: clues.domain,
  });
  if (!answer.ok) return brandFailure(answer);
  const { brand } = z
    .object({ brand: brandSchema.nullable().catch(null) })
    .catch({ brand: null })
    .parse(answer.body);
  if (!brand) return { outcome: "skipped", reason: `${NAME} has no match.` };
  return { outcome: "found", facts: brandFacts(brand) };
}

function brandFailure(answer: Extract<Answer, { ok: false }>): Lookup<never> {
  const code = errorCode.parse(answer.body).error_code;
  if (answer.status === 400 && code === "WEBSITE_ACCESS_ERROR") {
    return { outcome: "skipped", reason: "Its website could not be reached." };
  }
  if (answer.status === 400 && code === "NOT_FOUND") {
    return { outcome: "skipped", reason: `${NAME} has no match.` };
  }
  if (answer.status === 422) {
    return {
      outcome: "skipped",
      reason: "That is a personal or disposable email domain.",
    };
  }
  return { outcome: "failed", reason: failureReason(NAME, answer) };
}

function logoOf(logos: Brand["logos"], type: "logo" | "icon", mode?: string) {
  return logos.find(
    (logo) =>
      logo.url &&
      logo.type === type &&
      (mode === undefined || logo.mode === mode),
  );
}

function iconOf(logos: Brand["logos"]): Logo | undefined {
  return (
    logoOf(logos, "icon", "has_opaque_background") ??
    logoOf(logos, "icon", "light") ??
    logoOf(logos, "icon")
  );
}

/** Whether a monochrome icon needs a dark or a light tile behind it. */
function iconTone(icon: Logo | undefined): string | null {
  if (!icon) return null;
  if (icon.mode === "has_opaque_background") return "opaque";
  const match = /^#?([0-9a-f]{6})$/i.exec(
    icon.colors.find((colour) => colour.hex)?.hex?.trim() ?? "",
  );
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > 0.12) return null;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance < 0.2) return "dark";
  if (luminance > 0.8) return "light";
  return null;
}

function brandFacts(brand: Brand): CompanyFacts {
  const social = (type: string) =>
    brand.socials.find((entry) => entry.type === type)?.url;
  const icon = iconOf(brand.logos);
  const industry = brand.industries?.eic[0];
  return present({
    name: brand.title,
    description: brand.description ?? brand.slogan,
    logoUrl: logoOf(brand.logos, "logo", "light")?.url,
    logoDarkUrl: logoOf(brand.logos, "logo", "dark")?.url,
    iconUrl: icon?.url,
    iconDarkUrl: logoOf(brand.logos, "icon", "dark")?.url,
    iconTone: iconTone(icon),
    brandColor: brand.colors[0]?.hex,
    industry: industry?.industry,
    subIndustry: industry?.subindustry,
    city: brand.address?.city,
    stateCode: brand.address?.state_code,
    country: brand.address?.country,
    countryCode: brand.address?.country_code,
    phone: brand.phone,
    email: brand.email,
    linkedinUrl: social("linkedin"),
    twitterUrl: social("x") ?? social("twitter"),
    githubUrl: social("github"),
    pricingUrl: brand.links?.pricing,
    careersUrl: brand.links?.careers,
  });
}

async function person(
  fetcher: ProviderFetch,
  clues: PersonClues,
): Promise<Lookup<PersonFacts>> {
  const handle = linkedinHandle(clues.linkedinUrl);
  const email = clues.email?.trim();
  if (!handle && !email) {
    return {
      outcome: "skipped",
      reason: "No email address or LinkedIn profile to look up.",
    };
  }
  // Their own profile says who they are; without one, every clue the CRM holds.
  const employer = present({
    name: clues.companyName?.trim(),
    domain: clues.companyDomain?.trim(),
  });
  const name = present({
    first: clues.firstName.trim(),
    last: clues.lastName?.trim(),
  });
  const answer = await post(
    fetcher,
    "/people/enrich",
    handle
      ? { social_urls: [linkedinProfileUrl(handle)] }
      : {
          email,
          ...(Object.keys(name).length > 0 ? { name } : {}),
          ...(Object.keys(employer).length > 0 ? { company: employer } : {}),
        },
  );
  if (!answer.ok) {
    return [400, 404, 422].includes(answer.status)
      ? { outcome: "skipped", reason: `${NAME} has no match.` }
      : { outcome: "failed", reason: failureReason(NAME, answer) };
  }
  const { match } = z
    .object({ match: z.unknown() })
    .catch({ match: null })
    .parse(answer.body);
  const candidate = personSchema.safeParse(match);
  if (!candidate.success || candidate.data.score < MATCH_FLOOR) {
    return { outcome: "skipped", reason: `${NAME} has no firm match.` };
  }
  const found = candidate.data.person;
  return {
    outcome: "found",
    facts: present({
      title: found.current_role?.title,
      linkedinUrl: found.social_urls.find(
        (url) => linkedinHandle(url) !== null,
      ),
      twitterUrl: urlOnHost(found.social_urls, ["x.com", "twitter.com"]),
      githubUrl: urlOnHost(found.social_urls, ["github.com"]),
      imageUrl: urlOnHost([found.avatar_url], PHOTO_HOSTS),
    }),
  };
}

/** The entries with a value. */
function present<Key extends string>(
  values: Record<Key, string | null | undefined>,
): Partial<Record<Key, string>> {
  const kept: Partial<Record<Key, string>> = {};
  for (const key in values) {
    const value = values[key];
    if (value) kept[key] = value;
  }
  return kept;
}

export const ContextProvider = { person, company };
