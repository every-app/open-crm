import { createFileRoute, redirect } from "@tanstack/react-router";

// Opening the CRM lands on Contacts. The search carries over, so a link to a
// record sheet (`?record=`) still opens it.
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    throw redirect({ to: "/contacts", search: true, replace: true });
  },
});
