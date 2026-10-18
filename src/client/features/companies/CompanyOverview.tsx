import { ExternalLink } from "lucide-react";
import { cn } from "cn";
import type { Company } from "@/client/features/companies/companyFormat";
import type { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import { RecordFields } from "@/client/features/fields/RecordFields";
import { isEnriching } from "@/client/features/records/EnrichmentStatus";
import {
  InlineField,
  InlineTextArea,
} from "@/client/features/records/InlineField";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { OwnerField } from "@/client/features/records/owners";
import { safeHttpUrl } from "@/shared/safe-url";
import type { UpdateCompanyInput } from "@/types/schemas/companies";
import { WebsiteActivity } from "@/client/features/tracking/WebsiteActivity";

type Mutations = ReturnType<typeof useCompanyMutations>;
type CompanyPatch = Omit<UpdateCompanyInput, "id">;

/**
 * A company's Overview tab: what it does (once that's known), its details
 * and links, and its visits to the website. Its people and deals have tabs
 * of their own.
 */
export function CompanyOverview({
  company,
  mutations,
}: {
  company: Company;
  mutations: Mutations;
}) {
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
      {company.description ? (
        <SheetSection title="About">
          <InlineTextArea
            label="Description"
            value={company.description}
            {...field("description")}
          />
        </SheetSection>
      ) : null}

      <SheetSection
        title="Details"
        action={<FieldsSheetButton entity="COMPANY" />}
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
          <InlineField
            label="Website"
            type="url"
            value={company.website}
            placeholder="https://acme.com"
            {...field("website")}
          />
          <InlineField
            label="Industry"
            value={company.industry}
            {...field("industry")}
          />
          <InlineField
            label="Phone"
            type="tel"
            value={company.phone}
            {...field("phone")}
          />
          <InlineField
            label="Email"
            type="email"
            value={company.email}
            {...field("email")}
          />
          <InlineField label="City" value={company.city} {...field("city")} />
          <InlineField
            label="Country"
            value={company.country}
            {...field("country")}
          />
          <OwnerField
            owner={company.owner}
            saving={saving.includes("ownerId")}
            onSave={(ownerId) => update.mutate({ ownerId })}
          />
          <RecordFields entity="COMPANY" recordId={company.id} />
        </div>
        <AgentPending company={company} />
      </SheetSection>

      <CompanyLinks company={company} />
      <WebsiteActivity record={{ companyId: company.id }} />

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Added <LocalDateTime date={company.createdAt} />
      </p>
    </div>
  );
}

/**
 * What the agent hasn't found yet; the dot is lit while it looks (the
 * header says it's researching).
 */
function AgentPending({ company }: { company: Company }) {
  const missing = [
    company.industry ? null : "industry",
    company.description ? null : "description",
    company.linkedinUrl || company.twitterUrl || company.githubUrl
      ? null
      : "social links",
  ].filter(Boolean);
  if (missing.length === 0) return null;
  const running = isEnriching(company.enrichmentStatus, company.queued);
  return (
    <div className="mt-3 space-y-1.5 rounded-md bg-foreground/[0.03] p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            running ? "bg-primary" : "bg-muted-foreground",
          )}
        />
        <span className="text-xs font-medium">Not known yet</span>
      </div>
      <p className="text-xs/5 text-muted-foreground">{missing.join(", ")}</p>
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

function CompanyLinks({ company }: { company: Company }) {
  const links = LINKS.flatMap(([key, label]) => {
    const href = safeHttpUrl(company[key]);
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
