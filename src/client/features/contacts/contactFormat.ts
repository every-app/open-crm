import type { getContact, listContacts } from "@/serverFunctions/contacts";

export type Contact = Awaited<ReturnType<typeof getContact>>;
export type ContactRow = Awaited<
  ReturnType<typeof listContacts>
>["rows"][number];
