import { createFileRoute } from "@tanstack/react-router";
import { CurrencySettings } from "@/client/features/settings/CurrencySettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/currencies")({
  head: () => pageHead("Currencies"),
  component: CurrencySettings,
});
