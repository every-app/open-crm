import { useState, type ReactNode } from "react";
import { Button } from "@/client/components/ui/button";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import type { Contact } from "@/client/features/contacts/contactFormat";
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
import { normalizeUrl } from "@/shared/safe-url";
import type { UpdateContactInput } from "@/types/schemas/contacts";

type Mutations = ReturnType<typeof useContactMutations>;
type ContactPatch = Omit<UpdateContactInput, "id">;

/**
 * A contact's Overview tab: their details; who and what we know around them;
 * their links and visits. Their deals have a tab of their own.
 */
export function ContactOverview({
  contact,
  mutations,
}: {
  contact: Contact;
  mutations: Mutations;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const { update } = mutations;
  // The fields whose save is in flight show a spinner.
  const saving =
    update.isPending && update.variables ? Object.keys(update.variables) : [];
  const field = (key: keyof ContactPatch) => ({
    saving: saving.includes(key),
    onSave: (value: string) => update.mutate({ [key]: value }),
  });
  return (
    <div>
      <SheetSection
        title="Details"
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowEmpty((value) => !value)}
            >
              {showEmpty ? "Hide empty fields" : "Show empty fields"}
            </Button>
            <FieldsSheetButton entity="CONTACT" />
          </div>
        }
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
          />
          {(contact.lastName !== null && contact.lastName !== "") ||
          showEmpty ? (
            <InlineField
              label="Last name"
              value={contact.lastName}
              {...field("lastName")}
            />
          ) : null}
          {(contact.title !== null && contact.title !== "") || showEmpty ? (
            <InlineField
              label="Title"
              value={contact.title}
              {...field("title")}
            />
          ) : null}
          {(contact.email !== null && contact.email !== "") || showEmpty ? (
            <InlineField
              label="Email"
              type="email"
              value={contact.email}
              {...field("email")}
            />
          ) : null}
          {(contact.phone !== null && contact.phone !== "") || showEmpty ? (
            <InlineField
              label="Phone"
              type="tel"
              value={contact.phone}
              {...field("phone")}
            />
          ) : null}
          {(contact.linkedinUrl !== null && contact.linkedinUrl !== "") ||
          showEmpty ? (
            <InlineField
              label="LinkedIn"
              type="url"
              value={contact.linkedinUrl}
              placeholder="https://www.linkedin.com/in/…"
              {...field("linkedinUrl")}
            />
          ) : null}
          {(contact.twitterUrl !== null && contact.twitterUrl !== "") ||
          showEmpty ? (
            <InlineField
              label="X"
              type="url"
              value={contact.twitterUrl}
              placeholder="https://x.com/…"
              {...field("twitterUrl")}
            />
          ) : null}
          {(contact.githubUrl !== null && contact.githubUrl !== "") ||
          showEmpty ? (
            <InlineField
              label="GitHub"
              type="url"
              value={contact.githubUrl}
              placeholder="https://github.com/…"
              {...field("githubUrl")}
            />
          ) : null}
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
          <RecordFields
            entity="CONTACT"
            recordId={contact.id}
            showEmpty={showEmpty}
          />
        </div>
      </SheetSection>

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

/**
 * Their profiles, as links that open them: one saved as typed, without
 * https://, opens over https.
 */
function ContactLinks({ contact }: { contact: Contact }) {
  const links = LINKS.flatMap(([key, label]) => {
    const value = contact[key];
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
