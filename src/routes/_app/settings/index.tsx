import { createFileRoute } from "@tanstack/react-router";
import { GeneralSettings } from "@/client/features/settings/GeneralSettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/")({
  head: () => pageHead("Workspace"),
  component: GeneralSettings,
});
