import { z } from "zod";
import {
  CONNECT_ERRORS,
  MAILBOX_PROVIDERS,
  SYNC_SOURCES,
} from "@/shared/mailbox";

export const mailboxProviderSchema = z.object({
  provider: z.enum(MAILBOX_PROVIDERS),
});

/** A member's connection to `provider`: the caller's own unless `userId`. */
export const memberMailboxSchema = mailboxProviderSchema.extend({
  userId: z.string().min(1).max(256).optional(),
});

export const setAutoCreateSchema = z.object({
  source: z.enum(SYNC_SOURCES),
  enabled: z.boolean(),
});

/** Suppressing a domain, as the CRM's suppressDomainInput. */
export const suppressDomainSchema = z.object({
  domain: z.string().trim().min(1),
  reason: z.string().trim().max(200).optional(),
  purge: z.boolean().default(true),
});

/** A provider page's search: how the last connect came back. */
export const mailboxConnectSearchSchema = z.object({
  // The router reads `?connected=1` as the number 1.
  connected: z.literal(1).optional().catch(undefined),
  error: z.enum(CONNECT_ERRORS).optional().catch(undefined),
});
