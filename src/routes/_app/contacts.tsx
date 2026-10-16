import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/client/features/contacts/ContactsPage";
import { contactListSearchSchema } from "@/client/features/contacts/contactSearch";

export const Route = createFileRoute("/_app/contacts")({
  validateSearch: contactListSearchSchema,
  component: ContactsPage,
});
