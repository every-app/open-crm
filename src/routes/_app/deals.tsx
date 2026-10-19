import { createFileRoute } from "@tanstack/react-router";
import { DealsPage } from "@/client/features/deals/DealsPage";
import { dealListQueryOptions } from "@/client/features/deals/dealQueries";
import {
  dealListInput,
  dealListSearchSchema,
} from "@/client/features/deals/dealSearch";
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
  // without holding up navigation.
  loader: ({ deps }) => {
    void queryClient.prefetchQuery(dealListQueryOptions(deps));
  },
  component: DealsPage,
});
