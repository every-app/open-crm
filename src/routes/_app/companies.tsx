import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/client/features/companies/CompaniesPage";
import { companyListSearchSchema } from "@/client/features/companies/companySearch";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/companies")({
  head: () => pageHead("Companies"),
  validateSearch: companyListSearchSchema,
  component: CompaniesPage,
});
