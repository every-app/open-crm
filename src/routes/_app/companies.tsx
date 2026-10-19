import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/client/features/companies/CompaniesPage";
import { companyListQueryOptions } from "@/client/features/companies/companyQueries";
import {
  companyListInput,
  companyListSearchSchema,
} from "@/client/features/companies/companySearch";
import { pageHead } from "@/client/lib/page-title";
import { queryClient } from "@/client/tanstack-db";

export const Route = createFileRoute("/_app/companies")({
  head: () => pageHead("Companies"),
  validateSearch: companyListSearchSchema,
  // The loader fills the module-scoped query client, so keep it out of server
  // requests: one isolate must not cache another organization's records.
  ssr: false,
  loaderDeps: ({ search }) => companyListInput(search),
  // Starts the list on link intent (hovering Companies) and on a full load,
  // without holding up navigation.
  loader: ({ deps }) => {
    void queryClient.prefetchQuery(companyListQueryOptions(deps));
  },
  component: CompaniesPage,
});
