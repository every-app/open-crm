import { defineConfig } from "drizzle-kit";
import {
  everyAppWorker,
  localD1Path,
  type EveryAppWorkerManifest,
} from "@every-app/sdk/cloudflare";
import config from "../everyapp.config";

// @every-app/sdk 0.3.0-rc.14 types a feature as its secrets and settings
// alone, so one listing only capabilities or providers fails the type check.
// Drop the cast once the SDK types the whole feature.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
const manifest = config as Omit<typeof config, "features"> &
  Pick<EveryAppWorkerManifest, "features">;

// The fork shape's SQLite schema, migrated into D1 by `everyapp dev` (locally)
// and `everyapp deploy`. drizzle-kit studio opens the local database `pnpm dev`
// serves: the D1 database everyAppWorker() gives `cf dev`. It exists once
// `pnpm dev` or `pnpm db:migrate:local` has run.
const { env } = everyAppWorker({
  manifest,
  entrypoint: "",
  ctx: { mode: "development" },
});
const database: unknown = Reflect.get(env, "DB");
const databaseId: unknown =
  typeof database === "object" && database !== null
    ? Reflect.get(database, "id")
    : undefined;
const localDatabaseId = typeof databaseId === "string" ? databaseId : "";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle/sqlite",
  dbCredentials: {
    url: localD1Path(process.cwd(), localDatabaseId),
  },
});
