import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { ExternalLink } from "lucide-react";
import type { Company } from "@/client/features/companies/companyFormat";
import type { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import { RecordFields } from "@/client/features/fields/RecordFields";
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

/**
 * A company's editable details, links and website visits.
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
  const field = (key: keyof CompanyPatch) => ({
    saving: saving.includes(key),
    onSave: (value: string) => update.mutate({ [key]: value }),
  });

  return (
    <div>
      <SheetSection title={company.description ? "About" : undefined}>
        <InlineTextArea
          label="Description"
          value={company.description}
          {...field("description")}
        />
      </SheetSection>

      <SheetSection
        title="Details"
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowEmpty((value) => !value)}
            >
              {showEmpty ? "Hide empty fields" : "Add details"}
            </Button>
            <FieldsSheetButton entity="COMPANY" />
          </div>
        }
      >
        <div className="space-y-0.5">
          <InlineField
            label="Name"
            value={company.name}
            saving={saving.includes("name")}
            // A company always has a name: an emptied one is put back.
            onSave={(name) => {
              if (name) update.mutate({ name });
            }}
          />
          <InlineField
            label="Domain"
            type="url"
            value={company.domain}
            placeholder="acme.com"
            {...field("domain")}
          />
          {(company.website !== null && company.website !== "") || showEmpty ? (
            <InlineField
              label="Website"
              type="url"
              value={company.website}
              placeholder="https://acme.com"
              {...field("website")}
            />
          ) : null}
          {(company.industry !== null && company.industry !== "") ||
          showEmpty ? (
            <InlineField
              label="Industry"
              value={company.industry}
              {...field("industry")}
            />
          ) : null}
          {(company.phone !== null && company.phone !== "") || showEmpty ? (
            <InlineField
              label="Phone"
              type="tel"
              value={company.phone}
              {...field("phone")}
            />
          ) : null}
          {(company.email !== null && company.email !== "") || showEmpty ? (
            <InlineField
              label="Email"
              type="email"
              value={company.email}
              {...field("email")}
            />
          ) : null}
          {(company.city !== null && company.city !== "") || showEmpty ? (
            <InlineField label="City" value={company.city} {...field("city")} />
          ) : null}
          {(company.country !== null && company.country !== "") || showEmpty ? (
            <InlineField
              label="Country"
              value={company.country}
              {...field("country")}
            />
          ) : null}
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
      </SheetSection>

      <CompanyLinks company={company} />
      <WebsiteActivity record={{ companyId: company.id }} />

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Added <LocalDateTime date={company.createdAt} />
      </p>
    </div>
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
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            {link.label}
            <ExternalLink className="size-3" />
          </a>
        ))}
      </div>
    </SheetSection>
  );
}
