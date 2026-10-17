import { z } from "zod";
import {
  CONNECT_ERRORS,
  MAILBOX_PROVIDERS,
  SYNC_SOURCES,
} from "@/shared/mailbox";

export const mailboxProviderSchema = z.object({
  provider: z.enum(MAILBOX_PROVIDERS),
});

export const setAutoCreateSchema = z.object({
  source: z.enum(SYNC_SOURCES),
  enabled: z.boolean(),
});

/** A provider page's search: how the last connect came back. */
export const mailboxConnectSearchSchema = z.object({
  // The router reads `?connected=1` as the number 1.
  connected: z.literal(1).optional().catch(undefined),
  error: z.enum(CONNECT_ERRORS).optional().catch(undefined),
});
