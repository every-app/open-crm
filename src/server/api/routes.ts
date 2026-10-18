import type { ApiRoute } from "@/server/api/apiRoute";
import { activityRoutes } from "@/server/api/routes/activities";
import { companyRoutes } from "@/server/api/routes/companies";
import { contactRoutes } from "@/server/api/routes/contacts";
import { dealRoutes } from "@/server/api/routes/deals";
import { fieldRoutes } from "@/server/api/routes/fields";
import { googleRoutes } from "@/server/api/routes/google";
import { generalRoutes } from "@/server/api/routes/workspace";

/** Every endpoint under /api/v1, in the order the OpenAPI document lists them. */
export const apiRoutes: readonly ApiRoute[] = [
  ...generalRoutes,
  ...companyRoutes,
  ...contactRoutes,
  ...dealRoutes,
  ...activityRoutes,
  ...fieldRoutes,
  ...googleRoutes,
];
