import { z } from "zod";
import { SORT_DIRECTIONS } from "@/types/schemas/records";

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_SORTS = ["name", "email", "role", "joinedAt"] as const;

/**
 * Settings → Members' search, role filter, sort, page and hidden columns,
 * kept in the URL. A value that doesn't parse is dropped, so a stale link
 * still opens.
 */
export const membersSearchSchema = z.object({
  // The router reads `?q=42` as a number: keep it text.
  q: z
    .union([z.string(), z.number()])
    .transform(String)
    .optional()
    .catch(undefined),
  role: z.array(z.enum(MEMBER_ROLES)).optional().catch(undefined),
  sort: z.enum(MEMBER_SORTS).optional().catch(undefined),
  dir: z.enum(SORT_DIRECTIONS).optional().catch(undefined),
  page: z.coerce.number().int().positive().optional().catch(undefined),
  hide: z.array(z.string()).optional().catch(undefined),
});

export type MembersSearch = z.infer<typeof membersSearchSchema>;
