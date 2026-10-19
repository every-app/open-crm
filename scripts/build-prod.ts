/**
 * The production build `everyapp deploy` makes, with stand-in deploy inputs,
 * to check that it builds. Nothing it builds can be deployed: the identity key
 * is made here and thrown away, and the build output is removed afterwards.
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
  const inputs = {
    schema: 1,
    workerName: "every-check-crm",
    organizationId: "org_check",
    gatewayUrl: "https://apps.example.com",
    identityIssuer: "https://apps.example.com",
    identityPublicKeys: [publicKey],
    resources: { d1: { DB: { name: "every-check-crm", id: NO_ID } } },
  };
  writeFileSync(INPUTS, JSON.stringify(inputs), { mode: 0o600 });
  console.log("Building for production…");
  const build = spawnSync("pnpm", ["exec", "cf", "build"], {
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("The production build failed.");
  console.log("The production build passed.");
} finally {
  rmSync(INPUTS, { force: true });
  rmSync(OUTPUT, { recursive: true, force: true });
}
