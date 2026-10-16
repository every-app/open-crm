import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { ErrorState } from "@/client/components/ErrorState";
import { SkeletonCard } from "./SkeletonPresets";

/**
 * A load failure with a retry button. The message goes through
 * `getStandardErrorMessage`.
 */
export function QueryError({
  error,
  fallback,
  onRetry,
  isRetrying = false,
  variant,
  title,
}: {
  /** Omit to always show `fallback`, for errors the page words itself. */
  error?: unknown;
  /** Shown when the error has no message of its own. */
  fallback: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  variant?: "inline" | "card" | "page";
  title?: string;
}) {
  return (
    <ErrorState
      variant={variant}
      title={title}
      message={getStandardErrorMessage(error, fallback)}
      onRetry={onRetry}
      isRetrying={isRetrying}
    />
  );
}

/**
 * Loading, error with retry, or content for one query. A failed refetch keeps
 * the loaded content on screen, with the error above it.
 */
export function QueryState<TData>({
  query,
  errorFallback,
  loading = <SkeletonCard />,
  children,
}: {
  query: UseQueryResult<TData>;
  errorFallback: string;
  loading?: ReactNode;
  children: (data: TData) => ReactNode;
}) {
  if (query.isPending) return loading;

  const error = query.isError ? (
    <QueryError
      error={query.error}
      fallback={errorFallback}
      onRetry={() => void query.refetch()}
      isRetrying={query.isFetching}
    />
  ) : null;

  if (query.data === undefined) return error;

  return (
    <>
      {error}
      {children(query.data)}
    </>
  );
}
