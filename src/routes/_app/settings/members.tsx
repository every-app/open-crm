import { createFileRoute } from "@tanstack/react-router";
import { MembersSettings } from "@/client/features/settings/MembersSettings";
import { membersSearchSchema } from "@/types/schemas/members";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/members")({
  head: () => pageHead("Members"),
  validateSearch: membersSearchSchema,
  component: MembersSettings,
});
