import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { apiRoute } from "@/server/api/apiRoute";
import { EnrichmentQueueService } from "@/server/features/agent/services/EnrichmentQueueService";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { SavedViewService } from "@/server/features/saved-views/services/SavedViewService";
import { SearchService } from "@/server/features/search/services/SearchService";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { enrichmentQueueSchema } from "@/types/schemas/agent";
import {
  removeManualRateSchema,
  setManualRateSchema,
  setReportingCurrencySchema,
} from "@/types/schemas/currency";
import { dashboardSummarySchema } from "@/types/schemas/dashboard";
import {
  createSavedViewSchema,
  listSavedViewsSchema,
  savedViewIdSchema,
  updateSavedViewSchema,
} from "@/types/schemas/saved-views";
import { quickSearchSchema } from "@/types/schemas/search";

// Everything around the records: the workspace and its members, search, Home's
// summary, saved views, currencies and the agent's queue. As in the server
// functions: saved views are their owner's to change, and the reporting
// currency and rates are for owners and admins.

const none = z.object({});

const workspaceRoutes = [
  apiRoute({
    method: "GET",
    path: "/workspace",
    tag: "Workspace",
    summary:
      "The workspace: the company's name and website, and the caller's role in it.",
    input: none,
    handler: async (_data, context) => ({
      ...(await WorkspaceService.getWorkspace(context.organizationId)),
      role: context.role,
    }),
  }),
  apiRoute({
    method: "GET",
    path: "/users",
    tag: "Workspace",
    summary:
      "The organization's members who have opened the CRM, with their user ids (what ownerId takes).",
    input: none,
    handler: (_data, context) =>
      AuthRepository.listMembers(context.organizationId),
  }),
  apiRoute({
    method: "GET",
    path: "/search",
    tag: "Search",
    summary:
      "Companies, contacts and deals matching `q` (two characters or more), a few of each.",
    input: quickSearchSchema,
    handler: (data, context) =>
      SearchService.quick(context.organizationId, data.q),
  }),
  apiRoute({
    method: "GET",
    path: "/dashboard/summary",
    tag: "Dashboard",
    summary:
      "Home's sales summary in the reporting currency, for the caller's own deals (scope=me) or everyone's.",
    input: dashboardSummarySchema,
    handler: (data, context) =>
      DashboardService.summary(
        context.organizationId,
        context.userId,
        data.scope,
      ),
  }),
  apiRoute({
    method: "GET",
    path: "/enrichment/queue",
    tag: "Enrichment",
    summary: "What the research agent is working on and has booked for later.",
    input: enrichmentQueueSchema,
    handler: (data, context) =>
      EnrichmentQueueService.queue(context.organizationId, data.limit),
  }),
];

const savedViewRoutes = [
  apiRoute({
    method: "GET",
    path: "/saved-views",
    tag: "Saved views",
    summary: "The caller's saved views of a list, and the ones others share.",
    input: listSavedViewsSchema,
    handler: (data, context) =>
      SavedViewService.list(
        context.organizationId,
        context.userId,
        data.entity,
      ),
  }),
  apiRoute({
    method: "POST",
    path: "/saved-views",
    tag: "Saved views",
    summary: "Save a list's filters as a named view, personal unless shared.",
    input: createSavedViewSchema,
    handler: (data, context) =>
      SavedViewService.create(context.organizationId, context.userId, data),
  }),
  apiRoute({
    method: "PATCH",
    path: "/saved-views/{id}",
    tag: "Saved views",
    summary: "Rename, share or refilter one of the caller's own views.",
    input: updateSavedViewSchema,
    handler: (data, context) =>
      SavedViewService.update(context.organizationId, context.userId, data),
  }),
  apiRoute({
    method: "DELETE",
    path: "/saved-views/{id}",
    tag: "Saved views",
    summary: "Delete one of the caller's own views.",
    input: savedViewIdSchema,
    handler: (data, context) =>
      SavedViewService.remove(context.organizationId, context.userId, data.id),
  }),
];

const currencyRoutes = [
  apiRoute({
    method: "GET",
    path: "/currency/settings",
    tag: "Currency",
    summary:
      "The reporting currency, the exchange rates in use and the currencies deals are in.",
    input: none,
    handler: (_data, context) =>
      CurrencyService.getSettings(context.organizationId),
  }),
  apiRoute({
    method: "PATCH",
    path: "/currency/reporting-currency",
    tag: "Currency",
    summary: "Change the currency totals are reported in (owners and admins).",
    input: setReportingCurrencySchema,
    handler: (data, context) => {
      requireOrgPermission(context, { workspace: ["manage"] });
      return CurrencyService.setReportingCurrency(
        context.organizationId,
        data.currency,
      );
    },
  }),
  apiRoute({
    method: "PUT",
    path: "/currency/rates/{currency}",
    tag: "Currency",
    summary:
      "Set a manual rate: units of the reporting currency one unit of `currency` buys (owners and admins).",
    input: setManualRateSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { workspace: ["manage"] });
      return CurrencyService.setManualRate(
        context.organizationId,
        data.currency,
        data.rate,
      );
    },
  }),
  apiRoute({
    method: "DELETE",
    path: "/currency/rates/{currency}",
    tag: "Currency",
    summary:
      "Remove a manual rate; the fetched rate applies again (owners and admins).",
    input: removeManualRateSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { workspace: ["manage"] });
      return CurrencyService.removeManualRate(
        context.organizationId,
        data.currency,
      );
    },
  }),
  apiRoute({
    method: "POST",
    path: "/currency/rates/refresh",
    tag: "Currency",
    summary: "Fetch today's exchange rates now (owners and admins).",
    input: none,
    handler: (_data, context) => {
      requireOrgPermission(context, { workspace: ["manage"] });
      return CurrencyService.refreshRates(context.organizationId);
    },
  }),
];

export const generalRoutes = [
  ...workspaceRoutes,
  ...savedViewRoutes,
  ...currencyRoutes,
];
