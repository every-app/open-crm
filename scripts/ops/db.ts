import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { z } from "zod";

// How the operator scripts reach the CRM's database, as OpenSEO's scripts
// do: a fork's D1 through the CLI (`everyapp db query`, with your Cloudflare
// login, or the one `pnpm dev` uses with --local), and the first party's
// Postgres at POSTGRES_DATABASE_URL (--postgres), from the environment or,
// where the first-party deploy reads it, .everyapp/secrets.env. Every
// statement is written to run as is on both, one statement a query.

export type Row = Record<string, unknown>;

export type Database = {
  /** Where the statements go, printed with every result. */
  target: string;
  query: (sql: string) => Promise<Row[]>;
  close: () => Promise<void>;
};

/** A string as an SQL literal, the same in SQLite and Postgres. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** An aggregate as a number on both dialects (Postgres counts are bigints). */
export function int(expression: string): string {
  return `cast(${expression} as integer)`;
}

export function connect(options: {
  local: boolean;
  postgres: boolean;
}): Database {
  if (options.postgres) return connectPostgres();
  return {
    target: options.local ? "D1, pnpm dev's" : "D1, the deployed CRM's",
    query: (sql) => queryD1(sql, options.local),
    close: async () => {},
  };
}

const SECRETS_FILE = ".everyapp/secrets.env";

function postgresUrl(): string {
  const url =
    process.env.POSTGRES_DATABASE_URL?.trim() ||
    (existsSync(SECRETS_FILE)
      ? parseEnv(readFileSync(SECRETS_FILE, "utf8")).POSTGRES_DATABASE_URL
      : undefined);
  if (!url) {
    throw new Error(`Set POSTGRES_DATABASE_URL, or put it in ${SECRETS_FILE}.`);
  }
  return url;
}

function connectPostgres(): Database {
  const url = postgresUrl();
  const client = postgres(url, { max: 1 });
  return {
    target: `Postgres at ${new URL(url).hostname}`,
    query: async (sql) => [...(await client.unsafe<Row[]>(sql))],
    close: () => client.end(),
  };
}

// The NDJSON events `everyapp db query --json` writes, as far as they matter
// here: each statement's rows when it's done, and what to say otherwise.
const cliEvent = z.object({
  type: z.string(),
  message: z.string().optional(),
  data: z
    .object({
      results: z.array(z.array(z.record(z.string(), z.unknown()))).optional(),
      url: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
});

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** One statement on D1: its rows. A Cloudflare login it asks for is shown. */
function queryD1(sql: string, local: boolean): Promise<Row[]> {
  const args = ["exec", "everyapp", "db", "query", "--json"];
  if (local) args.push("--local");
  const child = spawn("pnpm", [...args, sql], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  let rows: Row[] | null = null;
  let failure: string | null = null;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const event = cliEvent.safeParse(parseLine(line));
    if (!event.success) return;
    const { type, message, data } = event.data;
    if (type === "done") rows = data?.results?.at(-1) ?? [];
    if (type === "error") failure = message ?? "everyapp db query failed.";
    if (type === "action_required") {
      console.error(
        [message, data?.url, data?.code && `Code: ${data.code}`]
          .filter(Boolean)
          .join("\n"),
      );
    }
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && rows) resolve(rows);
      else reject(new Error(failure ?? `everyapp db query exited ${code}.`));
    });
  });
}
