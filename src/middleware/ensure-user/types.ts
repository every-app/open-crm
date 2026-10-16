export type EnsuredUserContext = {
  userId: string;
  userEmail: string;
  // The gateway organization the signed identity names: every CRM row this
  // request reads or writes is scoped by it.
  organizationId: string;
  // The caller's gateway role in organizationId (owner, admin or member),
  // read from the signed identity on every request, never from a member row.
  role: string;
};
