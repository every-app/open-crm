// What each gateway role may do in the CRM, as OpenSEO gates project and
// integration management to owners and admins. Members work the pipeline:
// they create, edit, archive and restore records, talk to the agent and keep
// their own saved views. The client reads the same table to hide what a role
// can't do; the server enforces it (src/server/auth/org-gate.ts).
const statement = {
  // Workspace name, website, reporting currency and rates, the agent's model,
  // archive retention.
  workspace: ["manage"],
  // Add, change, reorder, archive and delete custom fields.
  field: ["manage"],
  // Permanently delete archived records.
  record: ["purge"],
  // Change, pause, archive or delete any team agent (its creator always may),
  // and stop anyone's run.
  agent: ["manage"],
  // Connect or disconnect the workspace's Slack; disconnect any member's
  // mailbox, or delete what it synced.
  connection: ["manage"],
  // Change the plan, buy credits and open the billing portal (hosted
  // billing): the owner's alone, as in OpenSEO.
  billing: ["manage"],
} as const;

type Statement = typeof statement;

export type OrgPermissionRequest = Partial<{
  [K in keyof Statement]: Array<Statement[K][number]>;
}>;

const FULL: OrgPermissionRequest = {
  workspace: ["manage"],
  field: ["manage"],
  record: ["purge"],
  agent: ["manage"],
  connection: ["manage"],
};

const ROLE_PERMISSIONS: Record<string, OrgPermissionRequest> = {
  owner: { ...FULL, billing: ["manage"] },
  admin: FULL,
  member: {},
};

function covers(
  allowed: readonly string[] | undefined,
  wanted: readonly string[] | undefined,
) {
  return (wanted ?? []).every((action) => (allowed ?? []).includes(action));
}

function grants(
  granted: OrgPermissionRequest,
  permissions: OrgPermissionRequest,
): boolean {
  return (
    covers(granted.workspace, permissions.workspace) &&
    covers(granted.field, permissions.field) &&
    covers(granted.record, permissions.record) &&
    covers(granted.agent, permissions.agent) &&
    covers(granted.connection, permissions.connection) &&
    covers(granted.billing, permissions.billing)
  );
}

// Roles may arrive comma-joined; permission checks OR across them, and
// unknown role names fail closed.
export function hasOrgPermission(
  role: string,
  permissions: OrgPermissionRequest,
): boolean {
  return role.split(",").some((name) => {
    const granted = ROLE_PERMISSIONS[name.trim()];
    return granted ? grants(granted, permissions) : false;
  });
}
