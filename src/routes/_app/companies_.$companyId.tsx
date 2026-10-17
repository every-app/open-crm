import { createFileRoute, redirect } from "@tanstack/react-router";

// A link to one company: the companies list with its sheet open.
export const Route = createFileRoute("/_app/companies_/$companyId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/companies",
      search: { record: `company:${params.companyId}` },
      replace: true,
    });
  },
});
