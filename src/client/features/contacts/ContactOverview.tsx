import { useState, type ReactNode } from "react";
import type { Contact } from "@/client/features/contacts/contactFormat";
import type { useContactMutations } from "@/client/features/contacts/useContactMutations";
import {
  DetailsActions,
  RecordFields,
} from "@/client/features/fields/RecordFields";
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
import type { UpdateContactInput } from "@/types/schemas/contacts";

type Mutations = ReturnType<typeof useContactMutations>;
type ContactPatch = Omit<UpdateContactInput, "id">;

/** The properties a contact may not have: blank ones show only when asked. */
const OPTIONAL: {
  key:
    | "lastName"
    | "title"
    | "email"
    | "phone"
    | "linkedinUrl"
    | "twitterUrl"
    | "githubUrl";
  label: string;
  type?: "email" | "tel" | "url";
  placeholder?: string;
}[] = [
  { key: "lastName", label: "Last name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  {
    key: "linkedinUrl",
    label: "LinkedIn",
    type: "url",
    placeholder: "https://www.linkedin.com/in/…",
  },
  {
    key: "twitterUrl",
    label: "X",
    type: "url",
    placeholder: "https://x.com/…",
  },
  {
    key: "githubUrl",
    label: "GitHub",
    type: "url",
    placeholder: "https://github.com/…",
  },
];

/**
 * A contact's details, then what we know around them: mail and meetings,
 * colleagues, visits to the website.
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
  const save = (patch: ContactPatch) => update.mutateAsync(patch);
  return (
    <>
      <SheetSection
        title="Details"
        action={
          <DetailsActions
            entity="CONTACT"
            recordId={contact.id}
            hasBlank={OPTIONAL.some((field) => !contact[field.key])}
            showEmpty={showEmpty}
            onShowEmpty={setShowEmpty}
          />
        }
      >
        <div className="space-y-0.5">
          <InlineField
            label="First name"
            value={contact.firstName}
            saving={saving.includes("firstName")}
            // A contact always has a first name: an emptied one is put back.
            onSave={(firstName) => (firstName ? save({ firstName }) : null)}
          />
          {OPTIONAL.filter((field) => showEmpty || contact[field.key]).map(
            ({ key, label, type, placeholder }) => (
              <InlineField
                key={key}
                label={label}
                type={type}
                value={contact[key]}
                placeholder={placeholder}
                saving={saving.includes(key)}
                onSave={(value) => save({ [key]: value })}
              />
            ),
          )}
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
        <p className="pt-1 text-xs text-muted-foreground">
          Added <LocalDateTime date={contact.createdAt} />
        </p>
      </SheetSection>

      <Relationship contact={contact} />
      <WebsiteActivity record={{ contactId: contact.id }} />
    </>
  );
}

/** A row of the property list below: its label, then what we know. */
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
function Relationship({ contact }: { contact: Contact }) {
  const { emails, meetings, lastReplyAt, nextMeeting, colleagues } =
    contact.relationship;
  if (emails === 0 && meetings === 0 && colleagues.length === 0) return null;
  return (
    <SheetSection title="Relationship">
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
          <Property label="Colleagues">
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
