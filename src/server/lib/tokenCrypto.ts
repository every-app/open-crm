import { UserFacingError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  appSecretCommand,
  TOKEN_KEY_SETTING,
  type SettingSetup,
} from "@/shared/app-settings";

// The mailbox and Slack tokens the CRM stores, encrypted at rest as OpenSEO
// encrypts its Google grants: under a secret only the Worker holds (OpenSEO's
// BETTER_AUTH_SECRET; here TOKEN_ENCRYPTION_KEY, set from any directory with
// `pnpm everyapp secret set TOKEN_ENCRYPTION_KEY --app crm`, the command
// appSecretCommand builds), whose SHA-256 is the key. AES-256-GCM with a
// random IV per value, stored as `enc:v1:` and base64(IV ‖ ciphertext ‖ tag).
// A value without the prefix was stored before tokens were encrypted: it
// reads as it is, and its next write encrypts it.

const KEY_SECRET = TOKEN_KEY_SETTING;
const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 32;

/** The key as set, or null while it is unset or too short to count. */
async function tokenSecret(): Promise<string | null> {
  const secret = await getOptionalEnvValue(KEY_SECRET);
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/**
 * Whether the key is there and, while it isn't, what sets it: the connect
 * pages say so before anyone clicks Connect. The manifest declares the key
 * optional, so the gateway opens the CRM without it and this is where its
 * absence shows. Everyone sees the command (a name, never a value); `canRun`
 * says whether the reader runs it themselves (owners and admins) or asks an
 * admin to. Under `everyapp dev` (`local`) the key goes in .dev.vars instead.
 */
export async function tokenKeyStatus(input: {
  canRun: boolean;
  local: boolean;
}): Promise<{ ready: boolean; setup: SettingSetup }> {
  return {
    ready: (await tokenSecret()) !== null,
    setup: {
      canRun: input.canRun,
      command: input.local ? null : appSecretCommand(KEY_SECRET),
      devVars: input.local ? [KEY_SECRET] : null,
    },
  };
}

async function tokenKey(): Promise<CryptoKey> {
  const secret = await tokenSecret();
  if (!secret) {
    throw new UserFacingError(
      "INTEGRATION_UNAVAILABLE",
      `Connections aren't set up on this CRM yet. An admin sets ${KEY_SECRET}, 32 or more random characters, with \`${appSecretCommand(KEY_SECRET)}\`.`,
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Refuses to start a connect whose tokens couldn't be stored. */
export async function requireTokenKey(): Promise<void> {
  await tokenKey();
}

export async function encryptToken(token: string): Promise<string> {
  const key = await tokenKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );
  let binary = "";
  for (const byte of [...iv, ...new Uint8Array(sealed)]) {
    binary += String.fromCharCode(byte);
  }
  return `${PREFIX}${btoa(binary)}`;
}

export async function decryptToken(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = await tokenKey();
  try {
    const bytes = Uint8Array.from(atob(stored.slice(PREFIX.length)), (char) =>
      char.charCodeAt(0),
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES) },
      key,
      bytes.subarray(IV_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new UserFacingError(
      "INTEGRATION_UNAVAILABLE",
      `This connection's tokens were stored under another ${KEY_SECRET}. Connect it again.`,
    );
  }
}
