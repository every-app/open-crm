import type { Plugin } from "vite";

/**
 * Dependencies that must never be reachable from the workers' eager startup
 * module graphs. The 128 MB isolate limit is shared by everything evaluated at
 * startup (production OOM bursts trace back to baseline heap, not leaks), so
 * each of these is either loaded lazily behind a dynamic import or kept out.
 * `generateBundle` below fails the build if one sneaks back in via a static
 * import chain.
 */
const EAGER_DENYLIST: Array<{ pattern: RegExp; expected: string }> = [
  {
    // The barrel (index.*) is allowed — the load hook rewrites its content to
    // re-export English only — as is en.* itself. Every other locale module
    // must stay out; if the load-hook swap ever regresses, the real barrel
    // pulls the individual locale files back in and they match here.
    pattern: /node_modules\/zod\/v4\/locales\/(?!en\.|index\.)/,
    expected:
      "replaced with an en-only barrel via the load hook below (we never " +
      "localize zod errors)",
  },
];

/**
 * Dependencies that must stay out of the browser's entry chunk. The whole app
 * renders inside <ClientOnly>, so every page waits for that chunk to load.
 */
const CLIENT_ENTRY_DENYLIST: Array<{ pattern: RegExp; expected: string }> = [
  {
    pattern: /node_modules\/(react-markdown|remark-gfm)\//,
    expected:
      "imported only from route components, which are code-split. Route options like loader and validateSearch are not, so " +
      "they must import from markdown-free modules",
  },
];

/**
 * Keeps the worker's eager server bundle lean, in two parts:
 *
 * 1. A `load`-hook swap of zod v4's all-languages locales barrel for an
 *    en-only barrel (the barrel is imported via relative specifiers inside
 *    zod itself, and pre-enforced resolvers in this plugin stack win the
 *    resolveId race, so matching the resolved file path in `load` is the
 *    reliable seam).
 * 2. A `generateBundle` assertion that walks the static-import closure of the
 *    worker entry chunk and fails the build if any EAGER_DENYLIST module is
 *    reachable — turning "we verified the chunk by grepping a sourcemap once"
 *    into a permanent regression test. The client build gets the same check
 *    against CLIENT_ENTRY_DENYLIST.
 */
export function leanWorkerBundle(): Plugin {
  return {
    name: "lean-worker-bundle",
    load(id) {
      // zod v4's core/classic entrypoints re-export the full locales barrel
      // (`export * as locales from "../locales/index.js"`, every language,
      // ~208 kB) into the eager bundle. Zod's default English error map
      // imports `../locales/en.js` directly and bypasses the barrel, so only
      // `z.locales.<lang>` consumers need it — and we never localize zod
      // errors. Serve an en-only barrel in its place so `z.locales.en` keeps
      // working and the other ~40 languages tree-shake away. (`./en.js`
      // resolves relative to the real barrel path, so no stub file needed.)
      const barrel = id.match(
        /node_modules\/zod\/v4\/locales\/index\.(js|cjs)$/,
      );
      if (barrel) {
        return `export { default as en } from "./en.${barrel[1]}";`;
      }
    },
    generateBundle(_options, bundle) {
      // EAGER_DENYLIST only matters for the worker build's isolate memory; the
      // client bundle never contains these packages (and the zod swap applies
      // everywhere). "ssr" is the CRM's Worker.
      const environment = this.environment.name;
      let denylist: typeof EAGER_DENYLIST;
      if (environment === "client") {
        denylist = CLIENT_ENTRY_DENYLIST;
      } else if (environment === "ssr") {
        denylist = EAGER_DENYLIST;
      } else {
        return;
      }

      // Bundle keys are chunk fileNames already.
      const chunkAt = (fileName: string) => {
        const output = bundle[fileName];
        return output?.type === "chunk" ? output : undefined;
      };

      // Static-import closure from the entry chunks: everything here is
      // evaluated at isolate startup. Dynamic imports are excluded — landing
      // there is the point of the lazy boundaries.
      const eager = new Set<string>();
      const queue = Object.values(bundle)
        .filter((output) => output.type === "chunk" && output.isEntry)
        .map((chunk) => chunk.fileName);
      while (queue.length > 0) {
        const fileName = queue.pop();
        if (fileName === undefined || eager.has(fileName)) continue;
        eager.add(fileName);
        queue.push(...(chunkAt(fileName)?.imports ?? []));
      }

      const violations: string[] = [];
      for (const rule of denylist) {
        for (const fileName of eager) {
          const hits =
            chunkAt(fileName)?.moduleIds.filter((id) =>
              rule.pattern.test(id),
            ) ?? [];
          if (hits.length > 0) {
            violations.push(
              `${hits[0]}${hits.length > 1 ? ` (+${hits.length - 1} more modules)` : ""}\n` +
                `  reached the eager startup graph via chunk ${fileName}\n` +
                `  expected: ${rule.expected}`,
            );
          }
        }
      }

      if (violations.length > 0) {
        this.error(
          `[lean-worker-bundle] denylisted module(s) in the ${environment} ` +
            `build's eager startup graph:\n\n${violations.join("\n\n")}\n\n` +
            `Restore the lazy/stub boundary, or update the denylist in ` +
            `vite-plugin-lean-worker-bundle.ts if this is intentional.`,
        );
      }
    },
  };
}
