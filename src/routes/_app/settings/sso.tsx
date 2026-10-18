import { createFileRoute } from "@tanstack/react-router";
import { SsoSettings } from "@/client/features/settings/SsoSettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/sso")({
  head: () => pageHead("SSO"),
  component: SsoSettings,
});
