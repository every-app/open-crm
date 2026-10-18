import { createFileRoute } from "@tanstack/react-router";
import { ApiSettings } from "@/client/features/settings/ApiSettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/api-keys")({
  head: () => pageHead("API Keys"),
  component: ApiSettings,
});
