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
        {captured ? (
          <span className="block text-xs font-normal text-muted-foreground">
            {captured}
          </span>
        ) : null}
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

/** The captured mail and meetings a version reads, if any. */
function capturedCopy(manifest: AgentManifest): string | null {
  const { email, calendar } = captureGrants(manifest.dataScope.resources);
  if (email && calendar) return "Plus captured email and meetings";
  if (email) return "Plus captured email";
  if (calendar) return "Plus captured meetings";
  return null;
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
