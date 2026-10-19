/**
 * Erases one organization from a CRM deployment, through the Worker
 * (src/server/features/erasure). See
 * docs/maintainers/runbooks/erase-organization.md before running it.
 *
 * Dry run (the default): what would go.
 *   node --env-file=<file> scripts/erase-organization.ts --organization <id>
 *
 * Erase, after reviewing the dry run:
 *   node --env-file=<file> scripts/erase-organization.ts --organization <id> \
 *     --execute --confirm <id>
 *
 * The env file holds CRM_URL (the CRM's origin) and ERASURE_SECRET (the
 * value set on the Worker for this erasure). Node 22.18 or later runs this
 * TypeScript as is.
 */
import process from "node:process";
import {
  ERASURE_PATH,
  signErasureRequest,
  type ErasureRequest,
} from "../src/shared/erasure.ts";

type Inventory = {
  exists: boolean;
  members: unknown[];
  rows: Record<string, number>;
  mailboxes: unknown[];
  slack: unknown;
  sessions: number;
  objects: number;
  autumnCustomerId: string;
};

type Step = { done: boolean; erased: Record<string, number> };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value.trim() : undefined;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (see the runbook).`);
  return value;
}

function endpoint(): URL {
  const url = new URL(ERASURE_PATH, required("CRM_URL"));
  const local =
    url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !local) {
    throw new Error("CRM_URL must use https.");
  }
  return url;
}

async function call<Result>(request: ErasureRequest): Promise<Result> {
  const body = JSON.stringify(request);
  const timestamp = String(Date.now());
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-erasure-timestamp": timestamp,
      "x-erasure-signature": await signErasureRequest(
        required("ERASURE_SECRET"),
        timestamp,
        body,
      ),
    },
    body,
  });
  const text = await response.text();
  if (response.status === 404) {
    throw new Error(
      "The Worker has no ERASURE_SECRET set (or CRM_URL is wrong).",
    );
  }
  if (!response.ok) {
    throw new Error(
      `The ${request.step} step failed (${response.status}): ${text}`,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Worker's own answer (erasureRoute.ts)
  return (JSON.parse(text) as { result: Result }).result;
}

const nothingLeft = (inventory: Inventory) =>
  !inventory.exists &&
  Object.keys(inventory.rows).length === 0 &&
  inventory.members.length === 0 &&
  inventory.mailboxes.length === 0 &&
  inventory.slack === null &&
  inventory.sessions === 0 &&
  inventory.objects === 0;

async function main() {
  const organizationId = option("organization");
  if (!organizationId) {
    throw new Error(
      "Pass --organization <id>. Add --execute --confirm <id> after the dry run.",
    );
  }
  const before = await call<Inventory>({ organizationId, step: "inventory" });
  console.log(
    JSON.stringify(
      {
        mode: process.argv.includes("--execute") ? "execute" : "dry-run",
        ...before,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--execute")) {
    console.log(
      "\nDry run only. Re-run with --execute --confirm <organization id> after review.",
    );
    return;
  }
  if (option("confirm") !== organizationId) {
    throw new Error("--confirm must be exactly the organization id.");
  }

  const totals: Record<string, number> = {};
  for (let round = 1; ; round += 1) {
    const step = await call<Step>({
      organizationId,
      step: "erase",
      confirm: organizationId,
    });
    for (const [key, value] of Object.entries(step.erased)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
    console.error(
      `step ${round}: ${step.done ? "done" : "continuing"}`,
      step.erased,
    );
    if (step.done) break;
  }

  const after = await call<Inventory>({ organizationId, step: "inventory" });
  if (!nothingLeft(after)) {
    console.log(JSON.stringify(after, null, 2));
    throw new Error(
      "Verification failed: something of the organization remains. Run the erase again.",
    );
  }
  console.log(
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        organizationId,
        erased: totals,
        verified: "No rows, members, connections, sessions or objects remain.",
        manual: [
          `Delete Autumn customer ${before.autumnCustomerId} (and its Stripe customer) by hand, unless billing must keep it.`,
          "Unset ERASURE_SECRET on the Worker.",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    `Erasure failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
