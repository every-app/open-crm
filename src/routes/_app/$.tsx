import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFound } from "@/client/components/NotFound";
import { pageHead } from "@/client/lib/page-title";

// Every address no other route takes. It stays a 404, shown inside the app
// instead of on a bare page.
export const Route = createFileRoute("/_app/$")({
  head: () => pageHead("Page not found"),
  loader: () => {
    throw notFound();
  },
  notFoundComponent: NotFound,
});
