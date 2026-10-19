import { UserFacingError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// The mailbox and Slack tokens the CRM stores, encrypted at rest as OpenSEO
// encrypts its Google grants: under a secret only the Worker holds (OpenSEO's
// BETTER_AUTH_SECRET; here TOKEN_ENCRYPTION_KEY, set with `everyapp secret
// set TOKEN_ENCRYPTION_KEY`), whose SHA-256 is the key. AES-256-GCM with a
// random IV per value, stored as `enc:v1:` and base64(IV ‖ ciphertext ‖ tag).
// A value without the prefix was stored before tokens were encrypted: it
// reads as it is, and its next write encrypts it.

const KEY_SECRET = "TOKEN_ENCRYPTION_KEY";
const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 32;

async function tokenKey(): Promise<CryptoKey> {
  const secret = await getOptionalEnvValue(KEY_SECRET);
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new UserFacingError(
      "INTEGRATION_UNAVAILABLE",
      `Connections aren't set up on this CRM yet. An admin sets ${KEY_SECRET}, 32 or more random characters, with \`everyapp secret set ${KEY_SECRET}\`.`,
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
