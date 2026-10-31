import { createFileRoute } from "@tanstack/react-router";
import { DealsPage } from "@/client/features/deals/DealsPage";
import { dealListQueryOptions } from "@/client/features/deals/dealQueries";
import {
  dealListInput,
  dealListSearchSchema,
} from "@/client/features/deals/dealSearch";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { pageHead } from "@/client/lib/page-title";
import { queryClient } from "@/client/tanstack-db";

export const Route = createFileRoute("/_app/deals")({
  head: () => pageHead("Deals"),
  validateSearch: dealListSearchSchema,
  // The loader fills the module-scoped query client, so keep it out of server
  // requests: one isolate must not cache another organization's records.
  ssr: false,
  loaderDeps: ({ search }) => dealListInput(search),
  // Starts the list on link intent (hovering Deals) and on a full load,
  // without holding up navigation. While deals are off the page shows a
  // note instead, so there is nothing to start.
  loader: ({ deps }) => {
    const workspace = queryClient.getQueryData(
      workspaceQueryOptions().queryKey,
    );
    if (workspace && !workspace.dealsEnabled) return;
    void queryClient.prefetchQuery(dealListQueryOptions(deps));
  },
  component: DealsPage,
});
