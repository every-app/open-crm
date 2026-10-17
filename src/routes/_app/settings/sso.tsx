import { createFileRoute } from "@tanstack/react-router";
import { SsoSettings } from "@/client/features/settings/SsoSettings";

export const Route = createFileRoute("/_app/settings/sso")({
  component: SsoSettings,
});
