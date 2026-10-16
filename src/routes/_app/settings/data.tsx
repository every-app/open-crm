import { createFileRoute } from "@tanstack/react-router";
import { ArchiveRetentionSettings } from "@/client/features/settings/ArchiveRetentionSettings";

export const Route = createFileRoute("/_app/settings/data")({
  component: ArchiveRetentionSettings,
});
