import { useState } from "react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import type { Company } from "@/client/features/companies/companyFormat";
import type { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import {
  DetailsActions,
  RecordFields,
} from "@/client/features/fields/RecordFields";
import {
  InlineField,
  InlineTextArea,
} from "@/client/features/records/InlineField";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { OwnerField } from "@/client/features/records/owners";
import { normalizeUrl } from "@/shared/safe-url";
import type { UpdateCompanyInput } from "@/types/schemas/companies";
import { WebsiteActivity } from "@/client/features/tracking/WebsiteActivity";

type Mutations = ReturnType<typeof useCompanyMutations>;
type CompanyPatch = Omit<UpdateCompanyInput, "id">;

/** The properties a company may not have: blank ones show only when asked. */
const OPTIONAL: {
  key: "website" | "industry" | "phone" | "email" | "city" | "country";
  label: string;
  type?: "email" | "tel" | "url";
  placeholder?: string;
}[] = [
  {
    key: "website",
    label: "Website",
    type: "url",
    placeholder: "https://acme.com",
  },
  { key: "industry", label: "Industry" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
];

/**
 * A website that is only the domain again ("https://www.acme.com" for
 * acme.com): the Domain row already shows it and opens it.
 */
function repeatsDomain(company: Company): boolean {
  const url = company.website ? normalizeUrl(company.website) : null;
  if (!url || !company.domain) return false;
  const { hostname, pathname, search } = new URL(url);
  return (
    hostname.replace(/^www\./, "") === company.domain.toLowerCase() &&
    pathname === "/" &&
    !search
  );
}

/**
 * A company's description, editable details, links and website visits.
 */
export function CompanyOverview({
  company,
  mutations,
}: {
  company: Company;
  mutations: Mutations;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const { update } = mutations;
  // The fields whose save is in flight show a spinner.
  const saving =
    update.isPending && update.variables ? Object.keys(update.variables) : [];
  const save = (patch: CompanyPatch) => update.mutateAsync(patch);
  // The rest wait for "Show empty fields": the blank ones, and a website the
  // Domain row already shows.
  const shown = OPTIONAL.filter(
    ({ key }) => company[key] && !(key === "website" && repeatsDomain(company)),
  );

  return (
    <>
      <SheetSection title={company.description ? "About" : undefined}>
        <InlineTextArea
          label="Description"
          value={company.description}
          saving={saving.includes("description")}
          onSave={(description) => save({ description })}
        />
      </SheetSection>

      <SheetSection
        title="Details"
        action={
          <DetailsActions
            entity="COMPANY"
            recordId={company.id}
            hasBlank={shown.length < OPTIONAL.length}
            showEmpty={showEmpty}
            onShowEmpty={setShowEmpty}
          />
        }
      >
        <div className="space-y-0.5">
          <InlineField
            label="Name"
            value={company.name}
            saving={saving.includes("name")}
            // A company always has a name: an emptied one is put back.
            onSave={(name) => (name ? save({ name }) : null)}
          />
          <InlineField
            label="Domain"
            type="url"
            value={company.domain}
            placeholder="acme.com"
            saving={saving.includes("domain")}
            onSave={(domain) => save({ domain })}
          />
          {(showEmpty ? OPTIONAL : shown).map(
            ({ key, label, type, placeholder }) => (
              <InlineField
                key={key}
                label={label}
                type={type}
                value={company[key]}
                placeholder={placeholder}
                saving={saving.includes(key)}
                onSave={(value) => save({ [key]: value })}
              />
            ),
          )}
          <OwnerField
            owner={company.owner}
            saving={saving.includes("ownerId")}
            onSave={(ownerId) => update.mutate({ ownerId })}
          />
          <RecordFields
            entity="COMPANY"
            recordId={company.id}
            showEmpty={showEmpty}
          />
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          Added <LocalDateTime date={company.createdAt} />
        </p>
      </SheetSection>

      <CompanyLinks company={company} />
      <WebsiteActivity record={{ companyId: company.id }} />
    </>
  );
}

const LINKS = [
  ["linkedinUrl", "LinkedIn"],
  ["twitterUrl", "X"],
  ["githubUrl", "GitHub"],
  ["pricingUrl", "Pricing"],
  ["careersUrl", "Careers"],
] as const;

/** Its profiles and pages; one imported without https:// opens over https. */
function CompanyLinks({ company }: { company: Company }) {
  const links = LINKS.flatMap(([key, label]) => {
    const value = company[key];
    const href = value ? normalizeUrl(value) : null;
    return href ? [{ href, label }] : [];
  });
  if (links.length === 0) return null;
  return (
    <SheetSection title="Links">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {links.map((link) => (
          <SafeExternalLink
            key={link.label}
            url={link.href}
            label={link.label}
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          />
        ))}
      </div>
    </SheetSection>
  );
}
