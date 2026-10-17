import { createFileRoute, redirect } from "@tanstack/react-router";

// A link to one contact: the contacts list with its sheet open.
export const Route = createFileRoute("/_app/contacts_/$contactId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/contacts",
      search: { record: `contact:${params.contactId}` },
      replace: true,
    });
  },
});
