import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { formatMoney } from "@/client/features/companies/companyFormat";
import {
  AgentFound,
  ContactBrief,
  ContactSuggestions,
} from "@/client/features/contacts/ContactResearch";
import {
  factsByField,
  sameValue,
  type Contact,
} from "@/client/features/contacts/contactFormat";
import { DEAL_STAGE_LABELS } from "@/shared/deal-stages";
import type { useContactMutations } from "@/client/features/contacts/useContactMutations";
import { RecordFields } from "@/client/features/fields/RecordFields";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/client/features/records/CompanyPicker";
import { InlineField } from "@/client/features/records/InlineField";
import {
  LocalDateTime,
  LocalDay,
  RelativeTime,
} from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  SheetEmpty,
  SheetSection,
} from "@/client/features/records/RecordSheet";
import { EmptyValue } from "@/client/features/records/cells";
import { OwnerField } from "@/client/features/records/owners";
import { safeHttpUrl } from "@/shared/safe-url";
import type { UpdateContactInput } from "@/types/schemas/contacts";

type Mutations = ReturnType<typeof useContactMutations>;
type ContactPatch = Omit<UpdateContactInput, "id">;

/**
 * A contact's Overview tab: the agent's suggestions, their details, the
 * agent's background on them, who and what we know around them, and their
 * deals.
 */
export function ContactOverview({
  contact,
  mutations,
}: {
  contact: Contact;
  mutations: Mutations;
}) {
  const { update } = mutations;
  // The fields whose save is in flight show a spinner.
  const saving =
    update.isPending && update.variables ? Object.keys(update.variables) : [];
  const field = (key: keyof ContactPatch) => ({
    saving: saving.includes(key),
    onSave: (value: string) => update.mutate({ [key]: value }),
  });
  const { applied } = factsByField(contact.facts);
  // Beside a value: where the agent found it, and a link that opens it.
  const trailing =
    (
      key: "title" | "linkedinUrl" | "twitterUrl" | "githubUrl",
      open?: string,
    ) =>
    (value: string) => {
      const fact = applied.get(key);
      return (
        <>
          {fact && sameValue(fact.value, value) ? (
            <AgentFound fact={fact} />
          ) : null}
          {open ? <OpenLink href={value} label={open} /> : null}
        </>
      );
    };

  return (
    <div>
      <ContactSuggestions contact={contact} mutations={mutations} />

      <SheetSection title="Details">
        <div className="space-y-0.5">
          <InlineField
            label="First name"
            value={contact.firstName}
            saving={saving.includes("firstName")}
            // A contact always has a first name: an emptied one is put back.
            onSave={(firstName) => {
              if (firstName) update.mutate({ firstName });
            }}
          />
          <InlineField
            label="Last name"
            value={contact.lastName}
            {...field("lastName")}
          />
          <InlineField
            label="Title"
            value={contact.title}
            placeholder="Head of Security"
            trailing={trailing("title")}
            {...field("title")}
          />
          <InlineField
            label="Email"
            type="email"
            value={contact.email}
            placeholder="ana@acme.com"
            {...field("email")}
          />
          <InlineField
            label="Phone"
            type="tel"
            value={contact.phone}
            {...field("phone")}
          />
          <InlineField
            label="LinkedIn"
            type="url"
            value={contact.linkedinUrl}
            placeholder="https://www.linkedin.com/in/…"
            trailing={trailing("linkedinUrl", "Open LinkedIn profile")}
            {...field("linkedinUrl")}
          />
          <InlineField
            label="X"
            type="url"
            value={contact.twitterUrl}
            placeholder="https://x.com/…"
            trailing={trailing("twitterUrl", "Open X profile")}
            {...field("twitterUrl")}
          />
          <InlineField
            label="GitHub"
            type="url"
            value={contact.githubUrl}
            placeholder="https://github.com/…"
            trailing={trailing("githubUrl", "Open GitHub profile")}
            {...field("githubUrl")}
          />
          <CompanyField
            company={contact.company}
            saving={saving.includes("companyId")}
            onSave={(companyId) => update.mutate({ companyId })}
          />
          <OwnerField
            owner={contact.owner}
            saving={saving.includes("ownerId")}
            onSave={(ownerId) => update.mutate({ ownerId })}
          />
        </div>
        <RecordFields entity="CONTACT" recordId={contact.id} />
      </SheetSection>

      {contact.brief ? <ContactBrief brief={contact.brief} /> : null}
      <WeKnowThem contact={contact} />
      <ContactLinks contact={contact} />
      <ContactDeals contact={contact} />

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Added <LocalDateTime date={contact.createdAt} />
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

/** The company they work at, picked from the live ones; empty for none. */
function CompanyField({
  company,
  saving,
  onSave,
}: {
  company: Contact["company"];
  saving: boolean;
  onSave: (companyId: string | null) => void;
}) {
  const id = useId();
  // While saving, the pick shows until the contact comes back with it.
  const [picked, setPicked] = useState<CompanyOption | null>(null);
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <label htmlFor={id} className="truncate text-xs text-muted-foreground">
        Company
      </label>
      <CompanyPicker
        id={id}
        value={saving ? picked : company}
        disabled={saving}
        placeholder="No company"
        onChange={(next) => {
          if ((next?.id ?? null) === (company?.id ?? null)) return;
          setPicked(next);
          onSave(next?.id ?? null);
        }}
      />
    </div>
  );
}

/** A row of the property lists below: its label, then what we know. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="truncate text-xs leading-5 text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Mail and meetings captured with them, and who else we know there. */
function WeKnowThem({ contact }: { contact: Contact }) {
  const { emails, meetings, lastReplyAt, nextMeeting, colleagues } =
    contact.relationship;
  if (emails === 0 && meetings === 0 && colleagues.length === 0) return null;
  return (
    <SheetSection title="We know them">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
        {emails > 0 ? (
          <Property label="Emails">
            <span className="tabular-nums">{emails}</span>
            <span className="text-muted-foreground">
              {" · "}
              {lastReplyAt ? (
                <>
                  last reply <RelativeTime date={lastReplyAt} />
                </>
              ) : (
                `${contact.firstName} has never replied`
              )}
            </span>
          </Property>
        ) : null}
        {meetings > 0 ? (
          <Property label="Meetings">
            <span className="tabular-nums">{meetings}</span>
          </Property>
        ) : null}
        {nextMeeting ? (
          <Property label="Next meeting">
            {nextMeeting.title ?? "Meeting"}
            <span className="text-muted-foreground">
              {" · "}
              <LocalDateTime date={nextMeeting.startsAt} />
            </span>
          </Property>
        ) : null}
        {colleagues.length > 0 ? (
          <Property label="Also here">
            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
              {colleagues.map((colleague) => (
                <Link
                  key={colleague.id}
                  from="/contacts"
                  to="/contacts"
                  search={(prev) => ({
                    ...prev,
                    record: colleague.id,
                    tab: undefined,
                  })}
                  className="min-w-0 truncate underline-offset-4 hover:underline"
                >
                  {colleague.name}
                  {colleague.title ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({colleague.title})
                    </span>
                  ) : null}
                </Link>
              ))}
            </span>
          </Property>
        ) : null}
      </dl>
    </SheetSection>
  );
}

const LINKS = [
  ["linkedinUrl", "LinkedIn"],
  ["twitterUrl", "X"],
  ["githubUrl", "GitHub"],
] as const;

/** Their profiles, as links that open them. */
function ContactLinks({ contact }: { contact: Contact }) {
  const links = LINKS.flatMap(([key, label]) => {
    const href = safeHttpUrl(contact[key]);
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

function ContactDeals({ contact }: { contact: Contact }) {
  return (
    <SheetSection title={`Deals (${contact.deals.length})`}>
      {contact.deals.length === 0 ? (
        <SheetEmpty
          title="Not on any deals"
          description="Deals are opened on the company, then people are added to them."
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {contact.deals.map((deal) => (
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
                <p className="truncate text-xs text-muted-foreground">
                  {deal.role ? `${deal.role} · ` : null}
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
