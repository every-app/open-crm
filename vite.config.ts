import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { devtools } from "@tanstack/devtools-vite";
import { leanWorkerBundle } from "./vite-plugin-lean-worker-bundle";

export default defineConfig(({ mode }) => {
  // Vitest sets mode to "test". Return a config without the Cloudflare and
  // TanStack Start plugins so unit tests never boot workerd or the SSR dev
  // server; only the tsconfig path alias is needed.
  if (mode === "test") {
    return {
      plugins: [tsConfigPaths()],
      test: {
        environment: "node",
        include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
        restoreMocks: true,
        clearMocks: true,
        // The key connection tokens are encrypted under, as a deploy sets it.
        env: { TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-0123456789" },
      },
    };
  }

  const showDevtools = process.env.VITE_SHOW_DEVTOOLS !== "false";

  return {
    // Static files (favicons, manifest) live beside the app code instead of at
    // the repo root.
    publicDir: "src/public",
    envPrefix: ["VITE_"],
    server: {
      // `everyapp dev` passes the port in PORT and puts its gateway in front.
      host: "127.0.0.1",
      port: Number(process.env.PORT ?? 3001),
      strictPort: true,
    },
    // Source maps for the Worker bundle only: "hidden" leaves no
    // sourceMappingURL and keeps maps out of the public assets. The deploy
    // uploads them so Workers logs and Issues point at source lines.
    environments: {
      ssr: { build: { sourcemap: "hidden" } },
    },
    plugins: [
      leanWorkerBundle(),
      showDevtools && mode === "development"
        ? devtools({
            consolePiping: {
              enabled: true,
              levels: ["log", "warn", "error", "info", "debug"],
            },
          })
        : null,
      // Reads cloudflare.config.ts. Local dev never touches remote resources.
      cloudflare({
        inspectorPort: false,
        viteEnvironment: { name: "ssr" },
        remoteBindings: false,
      }),
      tsConfigPaths(),
      tanstackStart(),
      viteReact(),
      tailwindcss(),
    ],
  };
});
