import { createFileRoute } from "@tanstack/react-router";
import { ApiSettings } from "@/client/features/settings/ApiSettings";

export const Route = createFileRoute("/_app/settings/api")({
  component: ApiSettings,
});
