import { defineConfig } from "drizzle-kit";

// The first-party shape's Postgres schema. `everyapp deploy` runs
// `drizzle-kit migrate` with this config and POSTGRES_DATABASE_URL from
// .everyapp/secrets.env before it uploads; locally, set it in the shell to
// run `pnpm db:migrate:pg`. `pnpm db:generate:pg` needs no database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/pg/schema.ts",
  out: "./drizzle/pg",
  dbCredentials: {
    url: process.env.POSTGRES_DATABASE_URL ?? "",
  },
});
