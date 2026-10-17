import { createFileRoute } from "@tanstack/react-router";
import { GeneralSettings } from "@/client/features/settings/GeneralSettings";

export const Route = createFileRoute("/_app/settings/")({
  component: GeneralSettings,
});
