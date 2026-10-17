import type { ReactNode, Ref, UIEventHandler } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import type { RecordKind } from "@/shared/records";
import { RECORD_COPY } from "./agentCopy";

/**
 * The Agent tab under its conversation bar: what the agent did on the record
 * and the conversation scroll together; the composer stays at the bottom.
 */
export function ThreadFrame({
  header,
  children,
  footer,
  scrollRef,
  onScroll,
}: {
  header: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {header}
        <div className="space-y-5 px-5 py-4">{children}</div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border px-5 py-3">
        {footer}
      </div>
    </div>
  );
}

/** A conversation with nothing in it yet: what to ask about this record. */
export function AgentIdle({
  kind,
  onAsk,
}: {
  kind: RecordKind;
  /** Asks a suggestion; without it, the suggestions are not offered. */
  onAsk?: (question: string) => void;
}) {
  const copy = RECORD_COPY[kind];
  return (
    <EmptyState
      variant="plain"
      size="sm"
      icon={Sparkles}
      title={copy.title}
      description={copy.blurb}
      action={
        onAsk ? (
          <div className="flex flex-wrap justify-center gap-2">
            {copy.suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                className="rounded-full text-xs text-muted-foreground"
                onClick={() => onAsk(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * In place of the composer when the gateway holds no model key: the agent
 * cannot answer, so nobody is invited to ask (OpenSEO's SAM setup gate).
 */
export function AgentUnavailable() {
  return (
    <p className="text-xs text-muted-foreground">
      The agent can't answer yet: its model isn't set up on your Every App
      gateway. An owner or admin sets it up once, as{" "}
      <Link
        to="/settings"
        className="text-foreground underline underline-offset-4"
      >
        Settings → General
      </Link>{" "}
      shows.
    </p>
  );
}
