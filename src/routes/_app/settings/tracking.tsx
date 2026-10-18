import { createFileRoute } from "@tanstack/react-router";
import { TrackingSettings } from "@/client/features/tracking/TrackingSettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/tracking")({
  head: () => pageHead("Tracking & Analytics"),
  component: TrackingSettings,
});
