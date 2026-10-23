import type { listMembers } from "@/serverFunctions/members";
import { MEMBER_ROLES, type MemberRole } from "@/types/schemas/members";

// A member's roles as the gateway sends them, possibly several comma-joined.

type Member = Awaited<ReturnType<typeof listMembers>>[number];

export function rolesOf(member: Member): string[] {
  return member.role
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

const isRole = (name: string): name is MemberRole =>
  MEMBER_ROLES.some((role) => role === name);

/** Owners first, then admins, then members. */
export function roleRank(member: Member): number {
  return Math.min(
    ...rolesOf(member).map((name) =>
      isRole(name) ? MEMBER_ROLES.indexOf(name) : MEMBER_ROLES.length,
    ),
  );
}
