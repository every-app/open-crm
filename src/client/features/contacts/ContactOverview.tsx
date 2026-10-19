import type { ReactNode } from "react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import {
  AgentFound,
  ContactBackground,
  Suggestion,
} from "@/client/features/contacts/ContactResearch";
import {
  factsByField,
  sameValue,
  type Contact,
} from "@/client/features/contacts/contactFormat";
import type { useContactMutations } from "@/client/features/contacts/useContactMutations";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import { RecordFields } from "@/client/features/fields/RecordFields";
import { InlineCompanyField } from "@/client/features/records/CompanyPicker";
import { InlineField } from "@/client/features/records/InlineField";
import {
  LocalDateTime,
  RelativeTime,
} from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { OwnerField } from "@/client/features/records/owners";
import { WebsiteActivity } from "@/client/features/tracking/WebsiteActivity";
import { safeHttpUrl } from "@/shared/safe-url";
import type { UpdateContactInput } from "@/types/schemas/contacts";

type Mutations = ReturnType<typeof useContactMutations>;
type ContactPatch = Omit<UpdateContactInput, "id">;

/**
 * A contact's Overview tab: their details, with what the agent suggests
 * under the row it would change; the agent's background on them; who and
 * what we know around them; their links and visits. Their deals have a tab
 * of their own.
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
  const { applied, proposed } = factsByField(contact.facts);
  // Under a row: the agent's suggestion for the fact it holds.
  const suggestion = (fact: string): ReactNode => {
    const proposal = proposed.get(fact);
    return proposal ? (
      <Suggestion fact={proposal} mutations={mutations} />
    ) : undefined;
  };
  // Beside a value: where the agent found it.
  const found =
    (key: "title" | "linkedinUrl" | "twitterUrl" | "githubUrl") =>
    (value: string) => {
      const fact = applied.get(key);
      return fact && sameValue(fact.value, value) ? (
        <AgentFound fact={fact} />
      ) : null;
    };

  return (
    <div>
      <SheetSection
        title="Details"
        action={<FieldsSheetButton entity="CONTACT" />}
      >
        <div className="space-y-0.5">
          <InlineField
            label="First name"
            value={contact.firstName}
            saving={saving.includes("firstName")}
            // A contact always has a first name: an emptied one is put back.
            onSave={(firstName) => {
              if (firstName) update.mutate({ firstName });
            }}
            // The agent suggests their whole name, first and last.
            suggestion={suggestion("name")}
          />
          <InlineField
            label="Last name"
            value={contact.lastName}
            {...field("lastName")}
          />
          <InlineField
            label="Title"
            value={contact.title}
            trailing={found("title")}
            suggestion={suggestion("title")}
            {...field("title")}
          />
          <InlineField
            label="Email"
            type="email"
            value={contact.email}
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
            trailing={found("linkedinUrl")}
            suggestion={suggestion("linkedinUrl")}
            {...field("linkedinUrl")}
          />
          <InlineField
            label="X"
            type="url"
            value={contact.twitterUrl}
            placeholder="https://x.com/…"
            trailing={found("twitterUrl")}
            suggestion={suggestion("twitterUrl")}
            {...field("twitterUrl")}
          />
          <InlineField
            label="GitHub"
            type="url"
            value={contact.githubUrl}
            placeholder="https://github.com/…"
            trailing={found("githubUrl")}
            suggestion={suggestion("githubUrl")}
            {...field("githubUrl")}
          />
          <InlineCompanyField
            company={contact.company}
            saving={saving.includes("companyId")}
            clearable
            onSave={(companyId) => update.mutate({ companyId })}
          />
          <OwnerField
            owner={contact.owner}
            saving={saving.includes("ownerId")}
            onSave={(ownerId) => update.mutate({ ownerId })}
          />
          <RecordFields entity="CONTACT" recordId={contact.id} />
        </div>
      </SheetSection>

      <ContactBackground brief={contact.brief} suggestion={suggestion} />
      <WeKnowThem contact={contact} />
      <ContactLinks contact={contact} />
      <WebsiteActivity record={{ contactId: contact.id }} />

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Added <LocalDateTime date={contact.createdAt} />
      </p>
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
      <dd className="min-w-0 px-2">{children}</dd>
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
                "never replied"
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
                <RecordLink
                  key={colleague.id}
                  record={{ kind: "contact", id: colleague.id }}
                >
                  {colleague.name}
                  {colleague.title ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({colleague.title})
                    </span>
                  ) : null}
                </RecordLink>
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
