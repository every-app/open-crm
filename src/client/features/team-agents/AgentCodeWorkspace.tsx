import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import type { getBuilderChat } from "@/serverFunctions/teamAgents";

// The agent's files in its builder chat, as the CRM's agent-code-workspace:
// each file as the builder last wrote it, or what that revision changed.

type AgentFile = Awaited<ReturnType<typeof getBuilderChat>>["files"][number];

type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Lines past this many comparisons are shown as replaced, not compared. */
const MAX_DIFF_CELLS = 250_000;

const removed = (text: string): DiffLine => ({ kind: "removed", text });
const added = (text: string): DiffLine => ({ kind: "added", text });

/** `after` against `before`, line by line (longest common subsequence). */
function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [...a.map(removed), ...b.map(added)];
  }
  // common[i][j]: how many lines a[i..] and b[j..] share, in order.
  const common = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i][j] =
        a[i] === b[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      lines.push(removed(a[i]));
      i += 1;
    } else {
      lines.push(added(b[j]));
      j += 1;
    }
  }
  return [...lines, ...a.slice(i).map(removed), ...b.slice(j).map(added)];
}

const DIFF_MARKS = { same: " ", added: "+", removed: "-" } as const;

/**
 * The agent's files as the builder writes them: one file at a time, as it
 * stands or as its latest revision changed it.
 */
export function AgentCodeWorkspace({
  files,
  working,
}: {
  files: AgentFile[];
  working: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"code" | "changes">("code");
  const file = files.find((entry) => entry.path === selected) ?? files[0];
  if (!file) return null;
  const previous = file.previousContent;
  const view = previous === null ? "code" : mode;
  return (
    <section
      aria-label="Generated agent files"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span
          className="flex min-w-0 flex-1 items-center gap-2"
          role={working ? "status" : undefined}
        >
          {working ? (
            <RefreshCw className="size-3.5 animate-spin text-primary" />
          ) : (
            <Check className="size-3.5 text-primary" />
          )}
          <span className="truncate text-sm font-medium">
            {working ? "Writing agent code" : "Agent code"}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
        </span>
        <div role="group" aria-label="Code view" className="flex gap-1">
          <Button
            variant={view === "code" ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={view === "code"}
            onClick={() => setMode("code")}
          >
            Code
          </Button>
          <Button
            variant={view === "changes" ? "secondary" : "ghost"}
            size="xs"
            disabled={previous === null}
            aria-pressed={view === "changes"}
            onClick={() => setMode("changes")}
          >
            Changes
          </Button>
        </div>
      </header>
      <div className="grid md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label="Agent files"
          className="flex gap-1 overflow-x-auto border-b border-border p-2 md:flex-col md:border-r md:border-b-0"
        >
          {files.map((entry) => (
            <button
              key={entry.path}
              type="button"
              aria-current={entry.path === file.path ? "true" : undefined}
              onClick={() => setSelected(entry.path)}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-left font-mono text-xs transition-colors",
                entry.path === file.path
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {entry.path.replace("agent/", "")}
            </button>
          ))}
        </nav>
        <div className="h-80 min-w-0 overflow-auto md:h-[22.5rem]">
          {view === "changes" && previous !== null ? (
            <div className="py-2 font-mono text-xs leading-relaxed">
              {lineDiff(previous, file.content).map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    "px-3 whitespace-pre-wrap [overflow-wrap:anywhere]",
                    line.kind === "added" && "bg-success/10",
                    line.kind === "removed" &&
                      "bg-destructive/10 text-muted-foreground",
                  )}
                >
                  <span className="mr-2 inline-block w-2 text-muted-foreground select-none">
                    {DIFF_MARKS[line.kind]}
                  </span>
                  {line.text}
                </div>
              ))}
            </div>
          ) : (
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {file.content}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
}
