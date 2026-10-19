import { defineConfig } from "drizzle-kit";
import { everyAppWorker, localD1Path } from "@every-app/sdk/cloudflare";
import manifest from "../everyapp.config";

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
