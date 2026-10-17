import type { listMembers } from "@/serverFunctions/members";
import { MEMBER_ROLES, type MemberRole } from "@/types/schemas/members";

// A member's roles as the gateway sends them, possibly several comma-joined.

export type Member = Awaited<ReturnType<typeof listMembers>>[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function rolesOf(member: Member): string[] {
  return member.role
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export const isRole = (name: string): name is MemberRole =>
  MEMBER_ROLES.some((role) => role === name);

export function roleLabel(member: Member): string {
  return rolesOf(member)
    .map((name) => (isRole(name) ? ROLE_LABELS[name] : name))
    .join(", ");
}

/** Owners first, then admins, then members. */
export function roleRank(member: Member): number {
  return Math.min(
    ...rolesOf(member).map((name) =>
      isRole(name) ? MEMBER_ROLES.indexOf(name) : MEMBER_ROLES.length,
    ),
  );
}

/** How many of `members` hold each role, for the Role filter. */
export function roleCounts(members: Member[]): Record<MemberRole, number> {
  const counts: Record<MemberRole, number> = { owner: 0, admin: 0, member: 0 };
  for (const member of members) {
    for (const name of rolesOf(member)) {
      if (isRole(name)) counts[name] += 1;
    }
  }
  return counts;
}
