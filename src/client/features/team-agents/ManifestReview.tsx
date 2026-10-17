import { useState } from "react";
import { cn } from "cn";
import {
  ACTION_LABELS,
  AGENT_ACTION_TYPES,
  captureGrants,
  recordResources,
  type AgentManifest,
} from "@/shared/team-agents";

/**
 * What a version may do, in the review's plain words (the CRM's review
 * card): when it runs, what it finds, what it does then, and the access that
 * adds up to.
 */
export function ManifestReview({ manifest }: { manifest: AgentManifest }) {
  const records = recordResources(manifest.dataScope.resources);
  const captured = capturedCopy(manifest);
  return (
    <dl className="space-y-3 text-sm">
      <Row label="When">
        <ul className="space-y-0.5">
          {manifest.triggers.map((trigger, index) => (
            <li key={index}>{trigger.summary}</li>
          ))}
        </ul>
      </Row>
      <Row label="Find">
        {manifest.dataScope.mode === "WORKSPACE"
          ? "Every record in the workspace"
          : records.map((record) => record.label).join(" · ")}
        <span className="block text-xs font-normal text-muted-foreground">
          {captured}
        </span>
      </Row>
      <Row label="Then">
        <ul className="space-y-0.5">
          {manifest.actions.map((action) => (
            <li key={action.type}>
              {ACTION_LABELS[action.type] ?? action.type}
              {action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST
                ? ` to ${action.destination.label}`
                : action.type === AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE
                  ? ` (${action.activityTypes.map((type) => type.toLowerCase()).join(", ")})`
                  : ""}
              {action.summary ? (
                <span className="block text-xs text-muted-foreground">
                  {action.summary}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Row>
      <Row label="Scope">
        <ul className="space-y-0.5">
          {manifest.access.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Row>
    </dl>
  );
}

/** The captured mail and meetings a version reads, in plain words. */
function capturedCopy(manifest: AgentManifest): string {
  const { email, calendar } = captureGrants(manifest.dataScope.resources);
  const on =
    manifest.dataScope.mode === "WORKSPACE" ? "every record" : "those records";
  if (email && calendar) {
    return `Plus the email and meetings your team's connected mailboxes and calendars captured on ${on}.`;
  }
  if (email) {
    return `Plus the email your team's connected mailboxes captured on ${on}. No meetings.`;
  }
  if (calendar) {
    return `Plus the meetings your team's connected calendars captured on ${on}. No email.`;
  }
  return "No captured email or meetings.";
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

type File = { path: string; content: string };

/** A version's exact files, one tab per file. */
export function FileTabs({ files }: { files: File[] }) {
  const [open, setOpen] = useState(files[0]?.path ?? "");
  const shown = files.find((file) => file.path === open) ?? files[0];
  if (!shown) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex gap-1 overflow-x-auto border-b border-border bg-muted/40 px-2 py-1">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => setOpen(file.path)}
            className={cn(
              "rounded px-2 py-1 font-mono text-xs",
              file.path === shown.path
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {file.path.replace("agent/", "")}
          </button>
        ))}
      </div>
      <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {shown.content}
      </pre>
    </div>
  );
}
