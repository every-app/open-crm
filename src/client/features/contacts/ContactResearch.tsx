import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  BAND_LABELS,
  currentValue,
  factLabel,
  factsByField,
  type Contact,
  type ContactFact,
} from "@/client/features/contacts/contactFormat";
import type { useContactMutations } from "@/client/features/contacts/useContactMutations";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { safeHostname, safeHttpUrl } from "@/shared/safe-url";

// What the research agent found about a contact. A fact it was sure of, or
// that filled a blank, is already on the record (the sparkle beside the
// value says where it came from); the rest wait here for a person to accept
// or dismiss, one per field at a time.

type Mutations = ReturnType<typeof useContactMutations>;

/** The agent's proposals, each with the evidence behind it. */
export function ContactSuggestions({
  contact,
  mutations,
}: {
  contact: Contact;
  mutations: Mutations;
}) {
  const { proposed } = factsByField(contact.facts);
  if (proposed.length === 0) return null;
  return (
    <SheetSection title="The agent suggests">
      <ul className="-mx-2 divide-y divide-border">
        {proposed.map((fact) => (
          <Suggestion
            key={fact.id}
            fact={fact}
            now={currentValue(contact, fact.field)}
            mutations={mutations}
          />
        ))}
      </ul>
    </SheetSection>
  );
}

function Suggestion({
  fact,
  now,
  mutations,
}: {
  fact: ContactFact;
  now: string | null;
  mutations: Mutations;
}) {
  const { decide } = mutations;
  // Which of this suggestion's buttons is waiting on the server, if any;
  // the others wait until it's settled.
  const choice =
    decide.isPending && decide.variables.factId === fact.id
      ? decide.variables.decision
      : null;
  const why = fact.evidence.map((item) => item.detail).join(" · ");
  return (
    <li className="flex min-w-0 items-start gap-3 px-2 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {factLabel(fact.field)}
          <Badge variant="outline" size="sm">
            {BAND_LABELS[fact.band]}
          </Badge>
        </p>
        <p className="text-sm font-medium [overflow-wrap:anywhere]">
          <FactValue value={fact.value} />
        </p>
        {now ? (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            Now: {now}
          </p>
        ) : null}
        {why ? (
          <p className="text-xs text-pretty text-muted-foreground">{why}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          pending={choice === "accept"}
          disabled={decide.isPending}
          onClick={() => decide.mutate({ factId: fact.id, decision: "accept" })}
        >
          {choice === "accept" ? null : <Check data-icon="inline-start" />}
          Accept
        </Button>
        <Button
          variant="ghost"
          size="sm"
          pending={choice === "dismiss"}
          disabled={decide.isPending}
          onClick={() =>
            decide.mutate({ factId: fact.id, decision: "dismiss" })
          }
        >
          {choice === "dismiss" ? null : <X data-icon="inline-start" />}
          Dismiss
        </Button>
      </div>
    </li>
  );
}

/** A suggested value: a link when it's an address, text otherwise. */
function FactValue({ value }: { value: string }) {
  const href = safeHttpUrl(value);
  if (!href) return value;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {value}
    </a>
  );
}

/**
 * Beside a value the agent put on the record: what it found, why it was
 * sure, when, and from where.
 */
export function AgentFound({ fact }: { fact: ContactFact }) {
  const source = safeHostname(fact.sourceUrl);
  return (
    <Tooltip>
      <TooltipTrigger
        delay={150}
        aria-label="Found by the agent"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <Sparkles className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm flex-col items-start gap-1 py-2 text-left">
        <span className="font-medium">Found by the agent</span>
        {fact.evidence.map((item) => (
          <span key={`${item.kind}-${item.detail}`} className="opacity-80">
            {item.detail}
          </span>
        ))}
        <span className="opacity-60">
          {BAND_LABELS[fact.band]} · <LocalDay date={fact.observedAt} />
          {source ? ` · ${source}` : null}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The agent's background on the person: who they are and where from. */
export function ContactBrief({
  brief,
}: {
  brief: NonNullable<Contact["brief"]>;
}) {
  const { sections } = brief;
  const lines = [
    ["Current role", sections.currentRole],
    ["Tenure", sections.tenure],
    ["Seniority", sections.seniority],
    ["Function", sections.function],
    ["Based", sections.location],
  ].flatMap(([label, value]) => (label && value ? [{ label, value }] : []));
  const previous = sections.previousRoles ?? [];
  const source = safeHttpUrl(brief.sourceUrl);
  return (
    <SheetSection
      title="Background"
      action={
        <span className="text-xs text-muted-foreground">
          {source ? (
            <>
              <a
                href={source}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                Source
              </a>
              {" · "}
            </>
          ) : null}
          <LocalDay date={brief.refreshedAt} />
        </span>
      }
    >
      <p className="text-sm text-pretty whitespace-pre-line">
        {brief.narrative}
      </p>
      {lines.length > 0 || previous.length > 0 ? (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 pt-1 text-sm">
          {lines.map((line) => (
            <div key={line.label} className="contents">
              <dt className="truncate text-xs leading-5 text-muted-foreground">
                {line.label}
              </dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{line.value}</dd>
            </div>
          ))}
          {previous.length > 0 ? (
            <div className="contents">
              <dt className="truncate text-xs leading-5 text-muted-foreground">
                Previously
              </dt>
              <dd className="min-w-0">
                <PreviousRoles roles={previous} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </SheetSection>
  );
}

function PreviousRoles({ roles }: { roles: string[] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
        {roles.length === 1 ? "1 role" : `${roles.length} roles`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-1 pt-1">
          {roles.map((role) => (
            <li key={role} className="[overflow-wrap:anywhere]">
              {role}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
