import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { archiveRetentionQueryOptions } from "@/client/features/settings/settingsQueries";
import { LocalDateTime } from "./LocalDateTime";

export function ArchivedRecordNotice({ archivedAt }: { archivedAt: string }) {
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
    <p
      role="status"
      className="border-b border-border bg-warning/10 px-5 py-3 text-xs"
    >
      Permanently deleted after <LocalDateTime date={expires} />. Restore this
      record to keep it.
    </p>
  );
}
