import { z } from "zod";
import {
  COOKIE_LIFETIMES,
  DOMAIN_SCOPES,
  TRACKING_FLAGS,
} from "@/shared/tracking";

export const setTrackingFlagSchema = z.object({
  flag: z.enum(TRACKING_FLAGS),
  enabled: z.boolean(),
});

export const setCookieLifetimeSchema = z.object({
  days: z
    .number()
    .int()
    .refine((days) => COOKIE_LIFETIMES.some((entry) => entry.days === days), {
      message: "That is not a cookie lifetime we offer.",
    }),
});

export const addTrackedDomainSchema = z.object({
  host: z.string().trim().min(1, "Enter a domain").max(253),
  scope: z.enum(DOMAIN_SCOPES),
});

export type AddTrackedDomainInput = z.infer<typeof addTrackedDomainSchema>;

export const removeTrackedDomainSchema = z.object({ id: z.string().min(1) });

export const verifyTrackingSchema = z.object({
  url: z.string().trim().min(1, "Enter a page to check").max(2048),
});

export const websiteActivitySchema = z.union([
  z.object({ contactId: z.string().min(1) }),
  z.object({ companyId: z.string().min(1) }),
]);

export type WebsiteActivityInput = z.infer<typeof websiteActivitySchema>;

// What the tracker POSTs, read from a stranger's browser. Lengths are
// bounded by the body limit and cut again when stored; a malformed optional
// field reads as absent rather than dropping the event.
const optionalText = z.string().optional().catch(undefined);

const rawTouchSchema = z
  .object({
    source: optionalText,
    medium: optionalText,
    campaign: optionalText,
    term: optionalText,
    content: optionalText,
    referrer: optionalText,
    landing: optionalText,
    at: z.number().finite().optional().catch(undefined),
  })
  .optional()
  .catch(undefined);

export const trackedEventSchema = z.object({
  type: z.enum(["page_view", "click", "form_submit"]),
  host: z.string().trim().min(1),
  path: z.string().catch("/"),
  referrer: optionalText,
  label: optionalText,
  at: z.number().finite().optional().catch(undefined),
  fields: z.record(z.string(), z.unknown()).optional().catch(undefined),
  touch: rawTouchSchema,
  firstTouch: rawTouchSchema,
});

export type TrackedEventInput = z.infer<typeof trackedEventSchema>;

export const trackingBatchSchema = z.object({
  siteId: z.string(),
  visitorId: z.string(),
  // Each event is checked on its own: one bad event drops itself only.
  events: z.array(z.unknown()),
});
