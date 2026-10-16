import { createFileRoute } from "@tanstack/react-router";
import { CurrencySettings } from "@/client/features/settings/CurrencySettings";

export const Route = createFileRoute("/_app/settings/currencies")({
  component: CurrencySettings,
});
