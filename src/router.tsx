import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";
import { DefaultCatchBoundary } from "./client/components/DefaultCatchBoundary";
import { NotFound } from "./client/components/NotFound";

const PRELOAD_ERROR_RELOAD_KEY = "vite-preload-error-reloaded-at";

// After a deploy replaces the hashed chunks, dynamic imports in already-open
// tabs 404 ("Importing a module script failed." / "Unexpected token '<'").
// Reload to pick up the new build, at most once per 30s so a failure a reload
// can't fix surfaces as an error instead of looping. Registered at module
// scope, not in a component, so it also catches chunks that fail while
// hydration is still in progress. Vite only emits this event in builds —
// exercise it via `vite preview` or a deploy, never `vite dev`.
//
// preventDefault() makes the failed import resolve to undefined, so the lazy
// route throws "reading 'component'" before the reload lands.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    try {
      const reloadedAt = Number(
        window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY) ?? 0,
      );
      if (Date.now() - reloadedAt < 30_000) return;
      window.sessionStorage.setItem(
        PRELOAD_ERROR_RELOAD_KEY,
        String(Date.now()),
      );
    } catch {
      // Without sessionStorage we can't bound reload attempts, so let the
      // error surface instead of risking a reload loop.
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}

/**
 * The CSP nonce server.ts made for this request, for the scripts the router
 * writes into the page; none on the client, which reads it from the page.
 */
function requestNonce(): string | undefined {
  try {
    const nonce: unknown = Reflect.get(getGlobalStartContext() ?? {}, "nonce");
    return typeof nonce === "string" ? nonce : undefined;
  } catch {
    return undefined;
  }
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
    ssr: { nonce: requestNonce() },
  });

  return router;
}
