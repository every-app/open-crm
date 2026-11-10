import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { archiveRetentionQueryOptions } from "@/client/features/settings/settingsQueries";
import { LocalDateTime } from "./LocalDateTime";

/** Under an archived record's header: when it is deleted, and Restore. */
export function ArchivedRecordNotice({
  archivedAt,
  restoring,
  onRestore,
}: {
  archivedAt: string;
  restoring: boolean;
  onRestore: () => void;
}) {
  const query = useQuery(archiveRetentionQueryOptions());
  if (query.isError)
    return (
      <div className="px-5 py-3">
        <QueryError
          error={query.error}
          fallback="The deletion date could not be loaded."
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  if (!query.data) return null;
  const expires = new Date(
    Date.parse(archivedAt) + query.data.days * 86_400_000,
  ).toISOString();
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-warning/10 px-5 py-2 text-xs"
    >
      <p>
        Permanently deleted after <LocalDateTime date={expires} />.
      </p>
      <Button
        variant="outline"
        size="xs"
        pending={restoring}
        onClick={onRestore}
      >
        Restore
      </Button>
    </div>
  );
}
