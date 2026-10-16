import { createFileRoute } from "@tanstack/react-router";
import { DealsPage } from "@/client/features/deals/DealsPage";
import { dealListSearchSchema } from "@/client/features/deals/dealSearch";

export const Route = createFileRoute("/_app/deals")({
  validateSearch: dealListSearchSchema,
  component: DealsPage,
});
