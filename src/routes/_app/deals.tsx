import { createFileRoute } from "@tanstack/react-router";
import { DealsPage } from "@/client/features/deals/DealsPage";
import { dealListSearchSchema } from "@/client/features/deals/dealSearch";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/deals")({
  head: () => pageHead("Deals"),
  validateSearch: dealListSearchSchema,
  component: DealsPage,
});
