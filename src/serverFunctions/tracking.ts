import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { TrackingSettingsService } from "@/server/features/tracking/services/TrackingSettingsService";
import { WebsiteActivityService } from "@/server/features/tracking/services/WebsiteActivityService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  addTrackedDomainSchema,
  removeTrackedDomainSchema,
  setCookieLifetimeSchema,
  setTrackingFlagSchema,
  verifyTrackingSchema,
  websiteActivitySchema,
} from "@/types/schemas/tracking";

// Settings → Tracking & Analytics: every member reads the settings (and
// copies the script); owners and admins change them, verify the
// installation and see traffic sources, since they decide what runs on the
// organization's website. A record's website activity is everyone's.

export const getTrackingSettings = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    // The snippet points at the CRM's own public origin, as the gateway
    // serves it.
    const origin = new URL(getRequest().url).origin;
    return TrackingSettingsService.getSettings(context.organizationId, origin);
  });

export const setTrackingFlag = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setTrackingFlagSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await TrackingSettingsService.setFlag(
      context.organizationId,
      data.flag,
      data.enabled,
    );
  });

export const setTrackingCookieLifetime = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setCookieLifetimeSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await TrackingSettingsService.setCookieDays(
      context.organizationId,
      data.days,
    );
  });

export const addTrackedDomain = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(addTrackedDomainSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return TrackingSettingsService.addDomain(context.organizationId, data);
  });

export const removeTrackedDomain = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(removeTrackedDomainSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await TrackingSettingsService.removeDomain(context.organizationId, data.id);
  });

export const rotateTrackingSiteId = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return TrackingSettingsService.rotateSiteId(context.organizationId);
  });

export const verifyTracking = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(verifyTrackingSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return TrackingSettingsService.verify(context.organizationId, data.url);
  });

export const getTrafficSources = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return TrackingSettingsService.sources(context.organizationId);
  });

export const getWebsiteActivity = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(websiteActivitySchema)
  .handler(async ({ data, context }) =>
    WebsiteActivityService.forRecord(context.organizationId, data),
  );
