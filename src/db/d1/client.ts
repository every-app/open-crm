import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

function boundDatabase(): D1Database {
  const database: unknown = Reflect.get(env, "DB");
  // The first-party shape (DATABASE_PROVIDER=postgres) binds no D1 and never
  // queries this client; the provider-aware `db` picks pgDb there.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the D1 binding when bound; never used when it isn't
  return database as D1Database;
}

export const d1Db = drizzle(boundDatabase(), { schema });
