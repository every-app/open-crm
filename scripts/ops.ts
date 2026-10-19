/**
 * Operator scripts for a deployed CRM, against its database.
 *
 *   pnpm ops organization <organization id | member email>
 *   pnpm ops requeue <task id> [--execute]
 *   pnpm ops dispatch
 *
 * A fork's D1 by default (through `everyapp db query`, with your Cloudflare
 * login); --local for the database `pnpm dev` uses; --postgres for the first
 * party's, at POSTGRES_DATABASE_URL (or in .everyapp/secrets.env). Each
 * prints JSON. Only `requeue --execute` writes. See
 * docs/maintainers/runbooks/operations.md.
 */
import process from "node:process";
import { parseArgs } from "node:util";
import { connect, type Database } from "./ops/db.ts";
import { dispatchHealth } from "./ops/dispatch.ts";
import { lookupOrganization } from "./ops/organization.ts";
import { requeueTask } from "./ops/requeue.ts";

const USAGE = `Usage:
  pnpm ops organization <organization id | member email>
  pnpm ops requeue <task id> [--execute]
  pnpm ops dispatch
Add --local for pnpm dev's database, or --postgres for the first party's.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    local: { type: "boolean", default: false },
    postgres: { type: "boolean", default: false },
    execute: { type: "boolean", default: false },
  },
});

function command(): ((db: Database) => Promise<object>) | null {
  const [name, argument] = positionals;
  if (name === "organization" && argument) {
    return (db) => lookupOrganization(db, argument);
  }
  if (name === "requeue" && argument) {
    return (db) => requeueTask(db, argument, values.execute);
  }
  if (name === "dispatch") return dispatchHealth;
  return null;
}

async function main() {
  const run = command();
  if (!run) throw new Error(USAGE);
  const db = connect(values);
  try {
    const result = await run(db);
    console.log(JSON.stringify({ database: db.target, ...result }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
