import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/client/components/QueryState";
import { slackMatchesQueryOptions } from "./slackQueries";

/** Which members are which Slack users, matched by exact email. */
export function SlackPeople() {
  const matches = useQuery(slackMatchesQueryOptions());
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">People</h3>
        <p className="text-xs text-muted-foreground">
          Matched by exact email address only. Someone with no exact match stays
          unmatched, and an agent stops instead of guessing at a similar name.
        </p>
      </div>
      <QueryState
        query={matches}
        errorFallback="The people could not be loaded."
      >
        {(data) => (
          <div className="divide-y divide-border rounded-lg border border-border">
            {data.rows.map((row) => (
              <div
                key={row.userId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.email}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.slackHandle ??
                    (row.reviewed ? "No exact email match" : "Not read yet")}
                </span>
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </section>
  );
}
