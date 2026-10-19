import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/client/features/contacts/ContactsPage";
import { contactListQueryOptions } from "@/client/features/contacts/contactQueries";
import {
  contactListInput,
  contactListSearchSchema,
} from "@/client/features/contacts/contactSearch";
import { pageHead } from "@/client/lib/page-title";
import { queryClient } from "@/client/tanstack-db";

export const Route = createFileRoute("/_app/contacts")({
  head: () => pageHead("Contacts"),
  validateSearch: contactListSearchSchema,
  // The loader fills the module-scoped query client, so keep it out of server
  // requests: one isolate must not cache another organization's records.
  ssr: false,
  loaderDeps: ({ search }) => contactListInput(search),
  // Starts the list on link intent (hovering Contacts) and on a full load,
  // without holding up navigation.
  loader: ({ deps }) => {
    void queryClient.prefetchQuery(contactListQueryOptions(deps));
  },
  component: ContactsPage,
});
