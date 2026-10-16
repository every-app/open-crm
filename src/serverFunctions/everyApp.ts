import { createServerFn } from "@tanstack/react-start";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

/**
 * Where the account menu sends people: the Every App gateway owns sign-in,
 * sign-out, organizations and teams. The deploy sets GATEWAY_URL; the
 * identity tokens' issuer is the same origin, so it stands in where
 * GATEWAY_URL isn't set (local dev).
 */
async function getEveryAppGatewayUrl(): Promise<string | null> {
  for (const name of ["GATEWAY_URL", "EVERYAPP_IDENTITY_ISSUER"]) {
    const value = await getOptionalEnvValue(name);
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // Not a URL; try the next one.
    }
  }
  return null;
}

/** The signed-in person, their role and their gateway, for the account menu. */
export const getEveryAppAccount = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => ({
    userId: context.userId,
    email: context.userEmail,
    role: context.role,
    gatewayUrl: await getEveryAppGatewayUrl(),
  }));
