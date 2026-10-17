import { AlertTriangle, Check } from "lucide-react";
import { describeSlackScopes, SLACK_SCOPE_GROUPS } from "@/shared/slack";

/**
 * What Slack grants, in plain words, grouped as the CRM's settings page
 * groups them; "broad" means the whole workspace, not one channel.
 */
export function ScopeGroups({
  title,
  scopes,
}: {
  title: string;
  scopes: string[];
}) {
  const held = describeSlackScopes(scopes);
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Broad means the whole workspace, not one channel.
        </p>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {SLACK_SCOPE_GROUPS.map((group) => {
          const entries = held.filter((entry) => entry.group === group.id);
          if (entries.length === 0) return null;
          const broad = entries.filter((entry) => entry.sensitive).length;
          return (
            <details key={group.id} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {group.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {group.summary}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {broad} broad of {entries.length}
                </span>
              </summary>
              <ul className="mt-2 space-y-1.5">
                {entries.map((entry) => (
                  <li
                    key={entry.scope}
                    className="flex items-start gap-2 text-sm"
                  >
                    {entry.sensitive ? (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    ) : (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    )}
                    {entry.grant}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
