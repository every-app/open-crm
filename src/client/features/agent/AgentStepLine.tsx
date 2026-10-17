import {
  Check,
  CircleDashed,
  FileText,
  Github,
  Linkedin,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Spinner } from "@/client/components/ui/spinner";
import type { Source, Step, Tone } from "./agentSteps";

const TONE_ICONS = {
  neutral: CircleDashed,
  success: Check,
  warning: TriangleAlert,
} satisfies Record<Tone, LucideIcon>;

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning-foreground dark:text-warning",
};

const SOURCE_ICONS = {
  linkedin: Linkedin,
  github: Github,
  web: FileText,
} satisfies Record<Source["network"], LucideIcon>;

/**
 * One thing the agent did: its outcome's icon (a spinner while it runs), what
 * it did and why, and the pages it read. A step it turned down reads in full
 * strength: those are the ones a rep checks.
 */
export function AgentStepLine({
  step,
  pending = false,
  detail,
}: {
  step: Step;
  pending?: boolean;
  /** More about the step, such as what a finished run reported. */
  detail?: string | null;
}) {
  const Icon = TONE_ICONS[step.tone];
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start gap-2 text-sm">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          {pending ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon
              aria-hidden
              className={cn("size-3.5", TONE_CLASSES[step.tone])}
            />
          )}
        </span>
        <span
          className={cn(
            "min-w-0 [overflow-wrap:anywhere]",
            step.tone === "warning"
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {step.label}
        </span>
      </div>
      {detail ? (
        <p className="ml-6 text-xs whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
      ) : null}
      {step.sources.length > 0 ? (
        <ul className="ml-6 flex flex-wrap gap-1.5">
          {step.sources.map((source) => {
            const SourceIcon = SOURCE_ICONS[source.network];
            return (
              <li key={source.url} className="min-w-0">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex max-w-60 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <SourceIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{source.title}</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
