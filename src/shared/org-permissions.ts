// What each gateway role may do in the CRM, as OpenSEO gates project and
// integration management to owners and admins. Members work the pipeline:
// they create, edit, archive and restore records and keep their own saved
// views. The client reads the same table to hide what a role
// can't do; the server enforces it (src/server/auth/org-gate.ts).
const statement = {
  // Workspace name, website, reporting currency and rates, archive retention; exporting everything in it is the owner's alone.
  workspace: ["manage", "export"],
  // Add, change, reorder, archive and delete custom fields.
  field: ["manage"],
  // Permanently delete archived records.
  record: ["purge"],
  // Disconnect any member's mailbox, or delete what it synced.
  connection: ["manage"],
} as const;

type Statement = typeof statement;

export type OrgPermissionRequest = Partial<{
  [K in keyof Statement]: Array<Statement[K][number]>;
}>;

const FULL: OrgPermissionRequest = {
  workspace: ["manage"],
  field: ["manage"],
  record: ["purge"],
  connection: ["manage"],
};

const ROLE_PERMISSIONS: Record<string, OrgPermissionRequest> = {
  owner: { ...FULL, workspace: ["manage", "export"] },
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
    covers(granted.connection, permissions.connection)
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
