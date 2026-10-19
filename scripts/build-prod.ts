/**
 * The production builds `everyapp deploy` makes, with stand-in deploy
 * inputs: on D1, and on Postgres through Hyperdrive. It checks that both
 * build. Nothing it builds can be deployed: the identity key is made here
 * and thrown away, and the build output is removed afterwards.
 *
 *   pnpm build:prod
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import process from "node:process";

// Where everyapp deploy writes its inputs for the length of the build, and
// where cf builds to (@every-app/sdk/cloudflare, DEPLOY_INPUTS_FILE).
const INPUTS = ".everyapp/deploy.json";
const OUTPUT = ".cloudflare/output";

const NO_ID = "00000000000000000000000000000000";

const SHAPES = [
  {
    name: "D1 Worker",
    env: {},
    inputs: {
      resources: { d1: { DB: { name: "every-check-crm", id: NO_ID } } },
    },
  },
  {
    name: "Postgres Worker",
    env: { OPEN_CRM_DATABASE: "postgres" },
    inputs: {
      resources: { hyperdrive: { HYPERDRIVE: { id: NO_ID } } },
    },
  },
];

if (existsSync(INPUTS)) {
  throw new Error(
    `${INPUTS} exists, so a deploy is building. Try again after it.`,
  );
}

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// An interrupted build still removes the inputs (finally, below).
process.on("SIGINT", () => {
  process.exitCode = 130;
});

try {
  mkdirSync(".everyapp", { recursive: true });
  for (const shape of SHAPES) {
    const inputs = {
      schema: 1,
      workerName: "every-check-crm",
      organizationId: "org_check",
      gatewayUrl: "https://apps.example.com",
      identityIssuer: "https://apps.example.com",
      identityPublicKeys: [publicKey],
      ...shape.inputs,
    };
    writeFileSync(INPUTS, JSON.stringify(inputs), { mode: 0o600 });
    console.log(`Building the ${shape.name} for production…`);
    const build = spawnSync("pnpm", ["exec", "cf", "build"], {
      stdio: "inherit",
      env: { ...process.env, ...shape.env },
    });
    if (build.status !== 0) {
      throw new Error(`The ${shape.name}'s production build failed.`);
    }
  }
  console.log("Both production builds passed.");
} finally {
  rmSync(INPUTS, { force: true });
  rmSync(OUTPUT, { recursive: true, force: true });
}
