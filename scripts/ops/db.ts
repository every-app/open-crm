import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

// How the operator scripts reach the CRM's database, as OpenSEO's scripts
// do: D1 through the CLI (`everyapp db query`, with your Cloudflare login, or
// the one `pnpm dev` uses with --local), one statement a query.

export type Row = Record<string, unknown>;

export type Database = {
  /** Where the statements go, printed with every result. */
  target: string;
  query: (sql: string) => Promise<Row[]>;
  close: () => Promise<void>;
};

/** A string as an SQL literal. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function connect(options: { local: boolean }): Database {
  return {
    target: options.local ? "D1, pnpm dev's" : "D1, the deployed CRM's",
    query: (sql) => queryD1(sql, options.local),
    close: async () => {},
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
