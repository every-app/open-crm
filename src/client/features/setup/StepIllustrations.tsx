import type { ReactNode } from "react";
import {
  Bot,
  Building2,
  Check,
  ChevronDown,
  Hash,
  Mail,
  Plus,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "cn";

// Get started's step pictures: a corner of the screen each step leads to,
// drawn in placeholders and cropped by the step's card. Decoration only.

/** A window peeking in from the card's bottom-right corner. */
function Corner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-0 bottom-0 block w-[62%] rounded-tl-xl border-t border-l border-border bg-card p-3 shadow-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Bar({ className }: { className?: string }) {
  return (
    <span
      className={cn("block h-2 rounded-full bg-foreground/10", className)}
    />
  );
}

function Dots() {
  return (
    <span className="flex gap-1">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="size-1.5 rounded-full bg-foreground/15" />
      ))}
    </span>
  );
}

const LOGO_TONES = [
  "bg-chart-1/25 text-chart-1",
  "bg-chart-2/25 text-chart-2",
  "bg-chart-3/25 text-chart-3",
];

function Companies() {
  return (
    <Corner className="h-[52%]">
      <Dots />
      <span className="mt-3 block space-y-2.5">
        {LOGO_TONES.map((tone, index) => (
          <span key={tone} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-md",
                tone,
              )}
            >
              <Building2 className="size-3" />
            </span>
            <Bar className={index === 1 ? "w-16" : "w-20"} />
            <Bar className="ml-auto w-6 bg-foreground/[0.06]" />
          </span>
        ))}
      </span>
    </Corner>
  );
}

function Inbox() {
  return (
    <Corner className="h-[52%]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Mail className="size-3.5" />
        <Bar className="w-10" />
      </span>
      <span className="mt-3 block space-y-2.5">
        {["w-20", "w-14", "w-24"].map((width, index) => (
          <span key={width} className="flex items-center gap-2">
            <span
              className={cn(
                "size-5 shrink-0 rounded-full",
                index === 0 ? "bg-primary/30" : "bg-foreground/10",
              )}
            />
            <span className="block flex-1 space-y-1">
              <Bar className={width} />
              <Bar className="w-10 bg-foreground/[0.06]" />
            </span>
          </span>
        ))}
      </span>
    </Corner>
  );
}

function Agent() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-4 bottom-4 block w-[64%] space-y-2"
    >
      <span className="ml-auto block w-[80%] space-y-1.5 rounded-xl rounded-br-sm bg-primary/15 p-2.5">
        <Bar className="w-full bg-primary/25" />
        <Bar className="w-2/3 bg-primary/25" />
      </span>
      <span className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2 shadow-sm">
        <Bot className="size-3.5 text-muted-foreground" />
        <Bar className="w-16" />
        <span className="ml-auto size-4 rounded-full bg-primary/40" />
      </span>
    </span>
  );
}

const CHART = ["h-5", "h-8", "h-6", "h-10", "h-9", "h-12"];

function Tracking() {
  return (
    <Corner className="h-[55%]">
      <span className="flex items-center gap-2">
        <Dots />
        <Bar className="w-14 bg-foreground/[0.07]" />
      </span>
      <span className="mt-3 flex h-12 items-end gap-1.5">
        {CHART.map((height, index) => (
          <span
            key={height}
            className={cn(
              "w-3 rounded-sm",
              height,
              index === CHART.length - 1 ? "bg-primary/40" : "bg-foreground/10",
            )}
          />
        ))}
      </span>
    </Corner>
  );
}

function Slack() {
  return (
    <Corner className="h-[52%]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Hash className="size-3.5" />
        <Bar className="w-12" />
      </span>
      <span className="mt-3 flex gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/20 text-primary">
          <Bot className="size-3.5" />
        </span>
        <span className="block flex-1 space-y-1.5 pt-0.5">
          <Bar className="w-12 bg-foreground/15" />
          <Bar className="w-full" />
          <Bar className="w-3/4" />
        </span>
      </span>
    </Corner>
  );
}

function Team() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-5 bottom-6 flex items-center"
    >
      <span className="relative z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
        <User className="size-6" />
        <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-card text-primary shadow-sm ring-1 ring-border">
          <Plus className="size-3" />
        </span>
      </span>
      <span className="z-10 -ml-3 flex size-12 items-center justify-center rounded-full bg-primary/20 text-primary/60 ring-4 ring-background">
        <User className="size-5" />
      </span>
      <span className="-ml-3 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary/40 ring-4 ring-background">
        <User className="size-4" />
      </span>
    </span>
  );
}

function Model() {
  return (
    <Corner className="h-[52%]">
      <span className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
        <Sparkles className="size-3.5 text-primary" />
        <Bar className="w-16" />
        <ChevronDown className="ml-auto size-3 text-muted-foreground" />
      </span>
      <span className="mt-2.5 block space-y-2 px-1">
        {["w-20", "w-14"].map((width, index) => (
          <span key={width} className="flex items-center gap-2">
            <Bar className={width} />
            {index === 0 ? (
              <Check className="ml-auto size-3 text-primary" />
            ) : null}
          </span>
        ))}
      </span>
    </Corner>
  );
}

function Context() {
  return (
    <Corner className="h-[52%]">
      <span className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-chart-1/25 text-chart-1">
          <Building2 className="size-4" />
        </span>
        <span className="block flex-1 space-y-1">
          <Bar className="w-16 bg-foreground/15" />
          <Bar className="w-10 bg-foreground/[0.06]" />
        </span>
      </span>
      <span className="mt-3 flex gap-1.5">
        {[
          "bg-chart-2/25",
          "bg-chart-3/25",
          "bg-chart-4/25",
          "bg-chart-5/25",
        ].map((tone) => (
          <span key={tone} className={cn("size-5 rounded-md", tone)} />
        ))}
      </span>
    </Corner>
  );
}

export const STEP_ILLUSTRATIONS = {
  model: Model,
  context: Context,
  companies: Companies,
  inbox: Inbox,
  agent: Agent,
  tracking: Tracking,
  slack: Slack,
  team: Team,
};
