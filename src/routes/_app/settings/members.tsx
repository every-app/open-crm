import { createFileRoute } from "@tanstack/react-router";
import { MembersSettings } from "@/client/features/settings/MembersSettings";
import { membersSearchSchema } from "@/types/schemas/members";

export const Route = createFileRoute("/_app/settings/members")({
  validateSearch: membersSearchSchema,
  component: MembersSettings,
});
