import { createFileRoute } from "@tanstack/react-router";
import { AiSettings } from "@/client/features/settings/AiSettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/ai")({
  head: () => pageHead("AI"),
  component: AiSettings,
});
