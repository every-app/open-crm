import { createFileRoute, redirect } from "@tanstack/react-router";

// A link to one deal: the deals list with its sheet open.
export const Route = createFileRoute("/_app/deals_/$dealId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/deals",
      search: { record: `deal:${params.dealId}` },
      replace: true,
    });
  },
});
