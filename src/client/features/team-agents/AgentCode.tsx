import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { structuredPatch } from "diff";
import { cn } from "cn";
import { QueryState } from "@/client/components/QueryState";
import { SettingsCard } from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { teamAgentFilesQueryOptions } from "./teamAgentQueries";

type AgentFile = {
  path: string;
  content: string;
  previousContent: string | null;
};

export const MANIFEST_PATH = "agent/manifest.json";

/**
 * The unsaved edits to a version's files: the page keeps them, with its other
 * changes, until its save bar saves or discards them.
 */
export type CodeEdits = {
  drafts: Record<string, string>;
  onDraft: (path: string, content: string) => void;
  /** What the checks refused in the last save. */
  issues: string[];
};

/**
 * A version's files (the CRM's agent code): one tab per file, each file's
 * change from its previous revision, and, with `edits`, editing.
 */
export function AgentCode({
  agentId,
  versionId,
  edits,
}: {
  agentId: string;
  versionId: string;
  edits?: CodeEdits;
}) {
  const files = useQuery(teamAgentFilesQueryOptions(agentId, versionId));
  return (
    <QueryState query={files} errorFallback="The files could not be loaded.">
      {(data) =>
        data.files.length === 0 ? (
          <SettingsCard>
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No files yet.
            </p>
          </SettingsCard>
        ) : (
          <CodeFiles key={versionId} files={data.files} edits={edits} />
        )
      }
    </QueryState>
  );
}

function CodeFiles({
  files,
  edits,
}: {
  files: AgentFile[];
  edits: CodeEdits | undefined;
}) {
  const [active, setActive] = useState(files[0]?.path ?? "");
  const [mode, setMode] = useState<"code" | "changes" | "edit">("code");
  const drafts = edits?.drafts ?? {};
  const file = files.find((entry) => entry.path === active) ?? files[0];
  if (!file) return null;

  const shown = drafts[file.path] ?? file.content;
  // An unsaved edit is compared with the saved file; otherwise the file is
  // compared with its previous revision.
  const before =
    drafts[file.path] !== undefined ? file.content : file.previousContent;
  const canCompare = before !== null && before !== shown;

  return (
    <SettingsCard>
      <div className="flex items-stretch bg-foreground/[0.02]">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {files.map((entry) => (
            <button
              key={entry.path}
              type="button"
              aria-pressed={entry.path === file.path}
              onClick={() => setActive(entry.path)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 border-r border-border px-3.5 font-mono text-xs",
                entry.path === file.path
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.path.split("/").pop()}
              {drafts[entry.path] !== undefined &&
              drafts[entry.path] !== entry.content ? (
                <span
                  className="size-1.5 rounded-full bg-warning"
                  aria-label="Edited"
                />
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2">
          {canCompare || mode === "changes" ? (
            <Button
              size="xs"
              variant={mode === "changes" ? "secondary" : "ghost"}
              onClick={() => setMode(mode === "changes" ? "code" : "changes")}
            >
              {mode === "changes" ? "Hide changes" : "Changes"}
            </Button>
          ) : null}
          {edits ? (
            <Button
              size="xs"
              variant={mode === "edit" ? "secondary" : "ghost"}
              onClick={() => setMode(mode === "edit" ? "code" : "edit")}
            >
              {mode === "edit" ? "Done" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>
      <div key={`${mode}:${file.path}`} className="max-h-[32rem] overflow-auto">
        {mode === "edit" && edits ? (
          <Textarea
            value={shown}
            spellCheck={false}
            aria-label={`Edit ${file.path}`}
            className="min-h-80 rounded-none border-0 bg-transparent px-5 py-4 font-mono text-xs leading-5 shadow-none focus-visible:ring-0 md:text-xs"
            onChange={(event) => edits.onDraft(file.path, event.target.value)}
          />
        ) : mode === "changes" && before !== null ? (
          <FileDiff before={before} after={shown} />
        ) : (
          <pre className="px-5 py-4 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {shown}
          </pre>
        )}
      </div>
      {edits && edits.issues.length > 0 ? (
        <ul className="space-y-1 px-5 py-3 text-sm text-destructive">
          {edits.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </SettingsCard>
  );
}

type DiffLine = {
  kind: "added" | "removed" | "same" | "gap";
  text: string;
  old: number | null;
  new: number | null;
};

/** The lines of a file's change, three lines of context around each part. */
function diffLines(before: string, after: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const patch = structuredPatch("", "", before, after, "", "", {
    context: 3,
  });
  for (const hunk of patch.hunks) {
    lines.push({
      kind: "gap",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      old: null,
      new: null,
    });
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const sign = line[0];
      // "\ No newline at end of file" says nothing a reader needs.
      if (sign === "\\") continue;
      const kind = sign === "+" ? "added" : sign === "-" ? "removed" : "same";
      lines.push({
        kind,
        text: line.slice(1),
        old: kind === "added" ? null : oldLine++,
        new: kind === "removed" ? null : newLine++,
      });
    }
  }
  return lines;
}

/** One file's change, as a unified diff. */
function FileDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="pb-2 font-mono text-xs leading-5">
      {diffLines(before, after).map((line, index) =>
        line.kind === "gap" ? (
          <div
            key={index}
            className="mt-2 bg-foreground/[0.03] px-5 py-1 text-muted-foreground first:mt-0"
          >
            {line.text}
          </div>
        ) : (
          <div
            key={index}
            className={cn(
              "flex",
              line.kind === "added" && "bg-success/10",
              line.kind === "removed" && "bg-destructive/10",
            )}
          >
            <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">
              {line.old ?? ""}
            </span>
            <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">
              {line.new ?? ""}
            </span>
            <span
              className={cn(
                "w-5 shrink-0 text-center select-none",
                line.kind === "added" && "text-success",
                line.kind === "removed" && "text-destructive",
              )}
            >
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}
            </span>
            <span className="min-w-0 flex-1 pr-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {line.text}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
