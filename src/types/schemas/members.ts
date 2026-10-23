export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_SORTS = ["name", "email", "role", "joinedAt"] as const;
