import { ExternalLink, Star } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  formatMoney,
  fullName,
  type Company,
} from "@/client/features/companies/companyFormat";
import type { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import { RecordFields } from "@/client/features/fields/RecordFields";
import { isEnriching } from "@/client/features/records/EnrichmentStatus";
import {
  InlineField,
  InlineTextArea,
} from "@/client/features/records/InlineField";
import {
  LocalDateTime,
  LocalDay,
} from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  SheetEmpty,
  SheetSection,
} from "@/client/features/records/RecordSheet";
import { EmptyValue, PersonAvatar } from "@/client/features/records/cells";
import { OwnerField } from "@/client/features/records/owners";
import { DEAL_STAGE_LABELS } from "@/shared/deal-stages";
import { safeHttpUrl } from "@/shared/safe-url";
import type { UpdateCompanyInput } from "@/types/schemas/companies";

type Mutations = ReturnType<typeof useCompanyMutations>;
type CompanyPatch = Omit<UpdateCompanyInput, "id">;

/** A company's Overview tab: its details, people and deals. */
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
      <SheetSection title="About">
        <InlineTextArea
          label="Description"
          value={company.description}
          placeholder="What the company does"
          {...field("description")}
        />
      </SheetSection>

      <SheetSection title="Details">
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
            trailing={(value) => <OpenLink href={value} label="Open website" />}
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
        </div>
        <RecordFields entity="COMPANY" recordId={company.id} />
        <AgentPending company={company} />
      </SheetSection>

      <CompanyLinks company={company} />

      <SheetSection title="Primary contact">
        {company.primaryContact ? (
          <div className="flex min-w-0 items-center gap-2.5 text-sm">
            <PersonAvatar src={null} name={fullName(company.primaryContact)} />
            <div className="min-w-0">
              <RecordLink
                record={{ kind: "contact", id: company.primaryContact.id }}
                className="block font-medium"
              >
                {fullName(company.primaryContact)}
              </RecordLink>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  company.primaryContact.title,
                  company.primaryContact.email,
                  company.primaryContact.phone,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nobody yet. Star one of the people below.
          </p>
        )}
      </SheetSection>

      <CompanyContacts company={company} mutations={mutations} />
      <CompanyDeals company={company} />

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Added <LocalDateTime date={company.createdAt} />
      </p>
    </div>
  );
}

function OpenLink({ href, label }: { href: string; label: string }) {
  const url = safeHttpUrl(href);
  if (!url) return null;
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      nativeButton={false}
      render={<a href={url} target="_blank" rel="noreferrer" />}
    >
      <ExternalLink />
    </Button>
  );
}

/** What the agent hasn't found yet, and whether it's looking. */
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
    <div className="mt-3 space-y-1 rounded-md bg-foreground/[0.03] p-3 text-xs">
      <p className="font-medium">
        {running ? "The agent is researching" : "Not known yet"}
      </p>
      <p className="text-muted-foreground">{missing.join(", ")}</p>
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

function CompanyContacts({
  company,
  mutations,
}: {
  company: Company;
  mutations: Mutations;
}) {
  const { setPrimary } = mutations;
  return (
    <SheetSection title={`People (${company.contacts.length})`}>
      {company.contacts.length === 0 ? (
        <SheetEmpty
          title="No contacts yet"
          description={`Everyone you talk to at ${company.name} shows up here.`}
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {company.contacts.map((contact) => {
            const name = fullName(contact);
            const primary = contact.id === company.primaryContactId;
            return (
              <li
                key={contact.id}
                className="flex min-w-0 items-center gap-2.5 px-2 py-2"
              >
                <PersonAvatar src={contact.imageUrl} name={name} size="sm" />
                <div className="min-w-0 flex-1">
                  <RecordLink
                    record={{ kind: "contact", id: contact.id }}
                    className="block text-sm font-medium"
                  >
                    {name}
                  </RecordLink>
                  <p className="truncate text-xs text-muted-foreground">
                    {[contact.title, contact.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-pressed={primary}
                  aria-label={
                    primary
                      ? `${name} is the primary contact`
                      : `Make ${name} primary`
                  }
                  title={primary ? "Primary contact" : "Make primary"}
                  disabled={setPrimary.isPending}
                  onClick={() => setPrimary.mutate(primary ? null : contact.id)}
                >
                  <Star
                    className={
                      primary ? "fill-current text-warning" : undefined
                    }
                  />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SheetSection>
  );
}

function CompanyDeals({ company }: { company: Company }) {
  return (
    <SheetSection title={`Deals (${company.deals.length})`}>
      {company.deals.length === 0 ? (
        <SheetEmpty
          title="No deals yet"
          description={`Nothing is being sold to ${company.name} right now.`}
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {company.deals.map((deal) => (
            <li
              key={deal.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <RecordLink
                  record={{ kind: "deal", id: deal.id }}
                  className="block font-medium"
                >
                  {deal.name}
                </RecordLink>
                <p className="text-xs text-muted-foreground">
                  {deal.expectedCloseDate ? (
                    <>
                      Closes <LocalDay date={deal.expectedCloseDate} />
                    </>
                  ) : (
                    "No close date"
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-right tabular-nums">
                  {deal.amount === null ? (
                    <EmptyValue />
                  ) : (
                    formatMoney(deal.amount, deal.currency)
                  )}
                </span>
                <Badge variant={deal.open ? "outline" : "secondary"}>
                  {DEAL_STAGE_LABELS[deal.stage]}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SheetSection>
  );
}
