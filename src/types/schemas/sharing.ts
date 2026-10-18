import { z } from "zod";

/** A shared chat's link token; one that matches no link finds no chat. */
export const sharedChatSchema = z.object({
  token: z.string().trim().min(1).max(128),
});
