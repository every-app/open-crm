import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// The CRM's database: D1, through the Worker's DB binding. Atomic
// multi-statement writes go through `runBatch` (./runBatch), never `db.batch`.
export const db = drizzle(env.DB, { schema });
