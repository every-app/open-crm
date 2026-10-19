import type { ReactNode } from "react";
import { Check, ChevronRight, Sparkles, X } from "lucide-react";
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
  type Contact,
  type ContactFact,
} from "@/client/features/contacts/contactFormat";
import type { useContactMutations } from "@/client/features/contacts/useContactMutations";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { EmptyValue } from "@/client/features/records/cells";
import { safeHostname, safeHttpUrl } from "@/shared/safe-url";

// What the research agent found about a contact. A fact it was sure of, or
// that filled a blank, is already on the record (the sparkle beside the
// value says where it came from); the rest wait under the row they would
// change for a person to accept or dismiss, one per field at a time.

type Mutations = ReturnType<typeof useContactMutations>;

/**
 * What the agent suggests for the row above it, as the CRM's Suggestion
 * draws it: the value, the evidence on one muted line, and ✓ and ✕. The
 * row shows what the record says now.
 */
export function Suggestion({
  fact,
  mutations,
}: {
  fact: ContactFact;
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
    <div className="flex min-w-0 items-start gap-2 pb-1.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm [overflow-wrap:anywhere]">
          <FactValue value={fact.value} />
        </p>
        {why ? (
          <p className="text-xs text-pretty text-muted-foreground">{why}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Accept"
          pending={choice === "accept"}
          disabled={decide.isPending}
          onClick={() => decide.mutate({ factId: fact.id, decision: "accept" })}
        >
          {choice === "accept" ? null : <Check />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          pending={choice === "dismiss"}
          disabled={decide.isPending}
          onClick={() =>
            decide.mutate({ factId: fact.id, decision: "dismiss" })
          }
        >
          {choice === "dismiss" ? null : <X />}
        </Button>
      </div>
    </div>
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
 * Beside a value the agent put on the record: why it was sure, when, and
 * from where.
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

// The brief's lines, each with the fact field whose suggestion sits under
// it: only seniority and function, the lines the record has a column for.
const BACKGROUND_LINES = [
  { label: "Current role", section: "currentRole", fact: null },
  { label: "Tenure", section: "tenure", fact: null },
  { label: "Seniority", section: "seniority", fact: "seniority" },
  { label: "Function", section: "function", fact: "function" },
  { label: "Based", section: "location", fact: null },
] as const;

/**
 * The agent's background on the person: who they are and where from, with
 * what it suggests for a line under that line. A suggestion for a line the
 * brief doesn't have still gets the line, to sit under.
 */
export function ContactBackground({
  brief,
  suggestion,
}: {
  brief: Contact["brief"];
  suggestion: (field: string) => ReactNode;
}) {
  const sections = brief?.sections;
  const lines = BACKGROUND_LINES.flatMap((line) => {
    const value = sections?.[line.section] ?? null;
    const suggested = line.fact ? suggestion(line.fact) : null;
    return value || suggested ? [{ label: line.label, value, suggested }] : [];
  });
  const previous = sections?.previousRoles ?? [];
  if (!brief && lines.length === 0) return null;
  const source = safeHttpUrl(brief?.sourceUrl);
  return (
    <SheetSection
      title="Background"
      action={
        brief ? (
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
        ) : null
      }
    >
      {brief ? (
        <p className="text-sm text-pretty whitespace-pre-line">
          {brief.narrative}
        </p>
      ) : null}
      {lines.length > 0 || previous.length > 0 ? (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 pt-1 text-sm">
          {lines.map((line) => (
            <div key={line.label} className="contents">
              <dt className="truncate text-xs leading-5 text-muted-foreground">
                {line.label}
              </dt>
              <dd className="min-w-0 px-2 [overflow-wrap:anywhere]">
                {line.value ?? <EmptyValue />}
                {line.suggested ? (
                  <div className="pt-1">{line.suggested}</div>
                ) : null}
              </dd>
            </div>
          ))}
          {previous.length > 0 ? (
            <div className="contents">
              <dt className="truncate text-xs leading-5 text-muted-foreground">
                Previously
              </dt>
              <dd className="min-w-0 px-2">
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
