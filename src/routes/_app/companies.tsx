import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/client/features/companies/CompaniesPage";
import { companyListSearchSchema } from "@/client/features/companies/companySearch";

export const Route = createFileRoute("/_app/companies")({
  validateSearch: companyListSearchSchema,
  component: CompaniesPage,
});
