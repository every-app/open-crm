import type { Brand } from "../lib/contextDev";

// How a Context.dev brand fills a company, ported from the CRM's
// lib/brand-mapping.ts. It fills blanks only: a value a person typed is never
// overwritten. The icon is the one exception (always the freshest mark), and
// the name only while it is still the domain the company was created from.

export const BRAND_FIELDS = [
  "name",
  "description",
  "logoUrl",
  "logoDarkUrl",
  "iconUrl",
  "iconDarkUrl",
  "iconTone",
  "brandColor",
  "industry",
  "subIndustry",
  "city",
  "stateCode",
  "country",
  "countryCode",
  "phone",
  "email",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
  "pricingUrl",
  "careersUrl",
] as const;

export type BrandField = (typeof BRAND_FIELDS)[number];

export type BrandUpdate = Partial<Record<BrandField, string>>;

type CompanySnapshot = Record<BrandField, string | null> & {
  domain: string | null;
};

/** The picture columns, which are copied into R2 before they are stored. */
export const COMPANY_IMAGE_FIELDS = [
  "logoUrl",
  "logoDarkUrl",
  "iconUrl",
  "iconDarkUrl",
] as const satisfies readonly BrandField[];

export type CompanyImageField = (typeof COMPANY_IMAGE_FIELDS)[number];

type Logo = Brand["logos"][number];
type LogoMode = "light" | "dark" | "has_opaque_background";

function pickEntry(
  logos: Brand["logos"],
  type: "logo" | "icon",
  mode?: LogoMode,
): Logo | undefined {
  return logos.find(
    (logo) =>
      logo.url &&
      logo.type === type &&
      (mode === undefined || logo.mode === mode),
  );
}

function pickIcon(logos: Brand["logos"]): Logo | undefined {
  return (
    pickEntry(logos, "icon", "has_opaque_background") ??
    pickEntry(logos, "icon", "light") ??
    pickEntry(logos, "icon")
  );
}

/** Whether a monochrome icon needs a dark or a light tile behind it. */
function iconTone(logos: Brand["logos"]): string | null {
  const icon = pickIcon(logos);
  if (!icon) return null;
  if (icon.mode === "has_opaque_background") return "opaque";
  const rgb = parseHex(icon.colors.find((colour) => colour.hex)?.hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  if (saturation > 0.12) return null;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance < 0.2) return "dark";
  if (luminance > 0.8) return "light";
  return null;
}

function parseHex(
  hex: string | null | undefined,
): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function social(socials: Brand["socials"], type: string): string | null {
  return socials.find((entry) => entry.type === type)?.url ?? null;
}

/** Whether `key` may be written over what the company holds now. */
function fillable(key: BrandField, current: CompanySnapshot): boolean {
  if (key === "iconUrl") return true;
  if (key === "name") return current.name === current.domain;
  return current[key] === null;
}

export function brandToUpdate(
  brand: Brand,
  current: CompanySnapshot,
): BrandUpdate {
  const update: BrandUpdate = {};
  const fill = (key: BrandField, value: string | null | undefined) => {
    if (value && fillable(key, current)) update[key] = value;
  };
  const eic = brand.industries?.eic[0];
  fill("name", brand.title);
  fill("description", brand.description ?? brand.slogan);
  fill("logoUrl", pickEntry(brand.logos, "logo", "light")?.url);
  fill("logoDarkUrl", pickEntry(brand.logos, "logo", "dark")?.url);
  fill("iconUrl", pickIcon(brand.logos)?.url);
  fill("iconDarkUrl", pickEntry(brand.logos, "icon", "dark")?.url);
  fill("iconTone", iconTone(brand.logos));
  fill("brandColor", brand.colors[0]?.hex);
  fill("industry", eic?.industry);
  fill("subIndustry", eic?.subindustry);
  fill("city", brand.address?.city);
  fill("stateCode", brand.address?.state_code);
  fill("country", brand.address?.country);
  fill("countryCode", brand.address?.country_code);
  fill("phone", brand.phone);
  fill("email", brand.email);
  fill("linkedinUrl", social(brand.socials, "linkedin"));
  fill(
    "twitterUrl",
    social(brand.socials, "x") ?? social(brand.socials, "twitter"),
  );
  fill("githubUrl", social(brand.socials, "github"));
  fill("pricingUrl", brand.links?.pricing);
  fill("careersUrl", brand.links?.careers);
  return update;
}

/** The part of `update` still fillable against the company as it is now. */
export function stillFillable(
  update: BrandUpdate,
  current: CompanySnapshot,
): BrandUpdate {
  const kept: BrandUpdate = {};
  for (const key of BRAND_FIELDS) {
    const value = update[key];
    if (value !== undefined && fillable(key, current)) kept[key] = value;
  }
  return kept;
}
