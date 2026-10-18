import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/client/features/contacts/ContactsPage";
import { contactListSearchSchema } from "@/client/features/contacts/contactSearch";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/contacts")({
  head: () => pageHead("Contacts"),
  validateSearch: contactListSearchSchema,
  component: ContactsPage,
});
