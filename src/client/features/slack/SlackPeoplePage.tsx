import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { refreshSlack } from "@/serverFunctions/slack";
import {
  slackKeys,
  slackMatchesQueryOptions,
  slackStatusQueryOptions,
} from "./slackQueries";

/**
 * Settings → Connections → Slack → people (the CRM's review after a
 * connect): which members are which Slack users, matched by exact email.
 */
export function SlackPeoplePage() {
  const queryClient = useQueryClient();
  const status = useQuery(slackStatusQueryOptions());
  const matches = useQuery(slackMatchesQueryOptions());
  const refresh = useMutation({
    mutationFn: () => refreshSlack(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: slackKeys.all }),
  });

  if (status.data && !status.data.connected) {
    return <Navigate to="/settings/connections/slack" replace />;
  }
  const refreshing = refresh.isPending || matches.data?.sync === "syncing";

  return (
    <SettingsPage title="Slack is connected">
      <QueryState
        query={matches}
        errorFallback="The people could not be loaded."
      >
        {({ rows, sync }) => (
          <SettingsSection
            title="People"
            description={`${rows.filter((row) => row.slackHandle).length} of ${rows.length} matched`}
            action={
              <Button
                variant="outline"
                pending={refreshing}
                onClick={() => refresh.mutate()}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            }
          >
            {sync === "stalled" ? (
              <p className="text-sm text-warning">
                The CRM is not reading Slack right now. These matches can be out
                of date.
              </p>
            ) : null}
            <SettingsCard>
              {rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  media="rows"
                  variant="plain"
                  title="No teammates to match"
                />
              ) : (
                rows.map((row) => (
                  <SettingsRow
                    key={row.userId}
                    label={row.name}
                    description={row.email}
                  >
                    {row.slackHandle ? (
                      <span className="text-sm">{row.slackHandle}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {row.reviewed ? "No exact email match" : "Not read yet"}
                      </span>
                    )}
                  </SettingsRow>
                ))
              )}
            </SettingsCard>
            <div className="flex justify-end">
              <Button
                nativeButton={false}
                render={<Link to="/settings/connections/slack" />}
              >
                Continue
              </Button>
            </div>
          </SettingsSection>
        )}
      </QueryState>
    </SettingsPage>
  );
}
