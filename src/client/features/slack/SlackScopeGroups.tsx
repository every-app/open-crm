import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Badge } from "@/client/components/ui/badge";
import { describeSlackScopes, SLACK_SCOPE_GROUPS } from "@/shared/slack";

/**
 * What Slack grants, in plain words, grouped as the CRM's settings page
 * groups them, then what it held back. "Broad" means the whole workspace,
 * not one channel.
 */
export function ScopeGroups({
  title,
  scopes,
  withheld = [],
}: {
  title: string;
  scopes: readonly string[];
  withheld?: readonly { scope: string; grant: string }[];
}) {
  const held = describeSlackScopes(scopes);
  return (
    <SettingsSection
      title={title}
      description="Broad means the whole workspace, not one channel."
    >
      <SettingsCard>
        {SLACK_SCOPE_GROUPS.map((group) => {
          const entries = held.filter((entry) => entry.group === group.id);
          if (entries.length === 0) return null;
          const broad = entries.filter((entry) => entry.sensitive).length;
          return (
            <details key={group.id} className="group">
              <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-4 outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium">
                    {group.label}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {group.summary}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                  {broad} broad of {entries.length}
                  <ChevronDown
                    aria-hidden
                    className="size-4 transition-transform group-open:rotate-180"
                  />
                </span>
              </summary>
              <ul className="space-y-2 px-5 pb-4">
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
        {withheld.map((entry) => (
          <SettingsRow
            key={entry.scope}
            label={
              <span className="flex items-center gap-2 text-muted-foreground">
                <X aria-hidden className="size-3.5 shrink-0" />
                {entry.grant}
              </span>
            }
          >
            <Badge variant="secondary">Not granted</Badge>
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
