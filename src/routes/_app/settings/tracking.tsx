import { createFileRoute } from "@tanstack/react-router";
import { TrackingSettings } from "@/client/features/tracking/TrackingSettings";

export const Route = createFileRoute("/_app/settings/tracking")({
  component: TrackingSettings,
});
