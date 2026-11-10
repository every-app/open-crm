import type { ReactNode } from "react";
import { Badge } from "@/client/components/ui/badge";

const STATES = {
  connected: { label: "Connected", variant: "success" },
  attention: { label: "Needs attention", variant: "warning" },
  disconnected: { label: "Not connected", variant: "outline" },
  // Nothing is wrong yet: nobody has set the provider up.
  unconfigured: { label: "Not set up", variant: "outline" },
  paused: { label: "Paused", variant: "secondary" },
} as const;

export type ConnectionState = keyof typeof STATES;

/** A connection's state, in the CRM's words: "Connected", "Not connected"… */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return <Badge variant={STATES[state].variant}>{STATES[state].label}</Badge>;
}

/** A section title with a status badge beside it. */
export function TitleWithStatus({
  children,
  status,
}: {
  children: ReactNode;
  status: ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {children}
      {status}
    </span>
  );
}
