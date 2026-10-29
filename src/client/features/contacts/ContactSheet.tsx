import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Star } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { fullName } from "@/client/features/companies/companyFormat";
import { ContactDeals } from "@/client/features/contacts/ContactDeals";
import { ContactOverview } from "@/client/features/contacts/ContactOverview";
import type { Contact } from "@/client/features/contacts/contactFormat";
import { contactQueryOptions } from "@/client/features/contacts/contactQueries";
import { useContactMutations } from "@/client/features/contacts/useContactMutations";
import { RecordActionsMenu } from "@/client/features/records/RecordActionsMenu";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  RecordSheetFrame,
  SheetStat,
  SheetStats,
} from "@/client/features/records/RecordSheet";
import { useRecordStack } from "@/client/features/records/recordStack";
import {
  EmptyValue,
  EntityLogo,
  OwnerCell,
  PersonAvatar,
} from "@/client/features/records/cells";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/** A contact's sheet, over whatever page opened it (RecordSheetHost). */
export function ContactSheet({ contactId }: { contactId: string }) {
  const query = useQuery(contactQueryOptions(contactId));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const { back } = useRecordStack();
  // Deleted forever: their sheet goes, and the one under it shows again.
  const mutations = useContactMutations(contactId, { onPurged: back });
  const contact = query.data;

  return (
    <RecordSheetFrame
      archivedAt={contact?.archivedAt}
      record={{ kind: "contact", id: contactId }}
      header={
        contact
          ? {
              media: (
                <PersonAvatar
                  src={contact.imageUrl}
                  name={fullName(contact)}
                  size="lg"
                />
              ),
              title: fullName(contact),
              description: metaLine([contact.title, contact.company?.name]),
              note: contactNote(contact),
              actions: (
                <ContactActions
                  contact={contact}
                  canPurge={canPurge}
                  mutations={mutations}
                />
              ),
            }
          : undefined
      }
      error={
        query.isError ? (
          <QueryError
            error={query.error}
            fallback="This contact could not be loaded."
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        ) : undefined
      }
      stats={contact ? <ContactStats contact={contact} /> : undefined}
      overview={
        contact ? (
          <ContactOverview contact={contact} mutations={mutations} />
        ) : null
      }
      lists={
        contact
          ? [
              {
                value: "deals",
                content: <ContactDeals contact={contact} />,
              },
            ]
          : undefined
      }
    />
  );
}

function ContactActions({
  contact,
  canPurge,
  mutations,
}: {
  contact: Contact;
  canPurge: boolean;
  mutations: ReturnType<typeof useContactMutations>;
}) {
  const archived = contact.archivedAt !== null;
  const company = contact.company;
  return (
    <>
      {contact.email ? (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={`mailto:${contact.email}`} />}
        >
          <Mail data-icon="inline-start" />
          <span className="max-sm:sr-only">Email</span>
        </Button>
      ) : null}
      {company && !contact.isPrimaryContact && !archived ? (
        <Button
          variant="outline"
          size="sm"
          pending={mutations.setPrimary.isPending}
          onClick={() => mutations.setPrimary.mutate(company.id)}
        >
          {mutations.setPrimary.isPending ? null : (
            <Star data-icon="inline-start" />
          )}
          <span className="max-sm:sr-only">Make primary</span>
        </Button>
      ) : null}
      <RecordActionsMenu
        name={fullName(contact)}
        archived={archived}
        canPurge={canPurge}
        consequence={purgeConsequence(contact)}
        pending={
          mutations.archive.isPending ||
          mutations.restore.isPending ||
          mutations.purge.isPending
        }
        onArchive={() => mutations.archive.mutate()}
        onRestore={() => mutations.restore.mutate()}
        onPurge={() => mutations.purge.mutate()}
      />
    </>
  );
}

/** "Head of Security · Acme", without blanks. */
function metaLine(parts: (string | null | undefined)[]): string | null {
  const shown = parts.flatMap((part) => (part?.trim() ? [part.trim()] : []));
  return shown.length > 0 ? shown.join(" · ") : null;
}

/** "Archived" and "Primary contact at Acme". */
function contactNote(contact: Contact): ReactNode {
  const archived = contact.archivedAt !== null;
  const primaryAt = contact.isPrimaryContact ? contact.company?.name : null;
  if (!archived && !primaryAt) return null;
  return (
    <>
      {archived ? <Badge variant="secondary">Archived</Badge> : null}
      {primaryAt ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="size-3 fill-current text-warning" aria-hidden />
          Primary contact at {primaryAt}
        </span>
      ) : null}
    </>
  );
}

function ContactStats({ contact }: { contact: Contact }) {
  const { company } = contact;
  return (
    <SheetStats>
      <SheetStat label="Company">
        {company ? (
          <RecordLink
            record={{ kind: "company", id: company.id }}
            className="flex items-center gap-2"
          >
            <EntityLogo
              src={company.iconUrl ?? company.logoUrl}
              darkSrc={company.iconDarkUrl}
              tone={company.iconTone}
              name={company.name}
              size="sm"
            />
            <span className="truncate">{company.name}</span>
          </RecordLink>
        ) : (
          <EmptyValue />
        )}
      </SheetStat>
      <SheetStat label="Email">
        {contact.email ? (
          <a
            href={`mailto:${contact.email}`}
            className="underline-offset-4 hover:underline"
          >
            {contact.email}
          </a>
        ) : (
          <EmptyValue />
        )}
      </SheetStat>
      <SheetStat label="Phone">
        {contact.phone ? (
          <a
            href={`tel:${contact.phone}`}
            className="underline-offset-4 hover:underline"
          >
            {contact.phone}
          </a>
        ) : (
          <EmptyValue />
        )}
      </SheetStat>
      <SheetStat label="Owner">
        <OwnerCell owner={contact.owner} />
      </SheetStat>
    </SheetStats>
  );
}

/** What deleting a contact forever takes with it, for the confirmation. */
function purgeConsequence(contact: Contact): string {
  const gone = "Their notes go too";
  return contact.email
    ? `${gone}, and the sync won't bring ${contact.email} back.`
    : `${gone}.`;
}
