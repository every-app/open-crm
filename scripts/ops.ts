/**
 * Operator scripts for a deployed CRM, against its database.
 *
 *   pnpm ops organization <organization id | member email>
 *
 * The deployed D1 by default (through `everyapp db query`, with your
 * Cloudflare login); --local for the database `pnpm dev` uses. Each prints
 * JSON, and writes nothing. See
 * docs/maintainers/runbooks/operations.md.
 */
import process from "node:process";
import { parseArgs } from "node:util";
import { connect, type Database } from "./ops/db.ts";
import { lookupOrganization } from "./ops/organization.ts";

const USAGE = `Usage:
  pnpm ops organization <organization id | member email>
Add --local for pnpm dev's database.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    local: { type: "boolean", default: false },
  },
});

function command(): ((db: Database) => Promise<object>) | null {
  const [name, argument] = positionals;
  if (name === "organization" && argument) {
    return (db) => lookupOrganization(db, argument);
  }
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
