import { createFileRoute } from "@tanstack/react-router";
import { MembersSettings } from "@/client/features/settings/MembersSettings";

export const Route = createFileRoute("/_app/settings/members")({
  component: MembersSettings,
});
