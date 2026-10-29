// The CRM's own settings a feature needs (everyapp.config.ts declares them
// optional, so the gateway opens the CRM without them): what to call one, and
// the command that sets it from anywhere. Never a value.

/** The CRM's id on the gateway (everyapp.config.ts). */
const APP_ID = "crm";

/**
 * The key mailbox tokens are encrypted under
 * (src/server/lib/tokenCrypto.ts): nothing connects until it is set.
 */
export const TOKEN_KEY_SETTING = "TOKEN_ENCRYPTION_KEY";

/** The command that sets one of the CRM's own settings, from any directory. */
export function appSecretCommand(name: string): string {
  return `pnpm everyapp secret set ${name} --app ${APP_ID}`;
}

/**
 * What sets a setting, as the pages show it: the command (a deployment) or
 * the .dev.vars name (`everyapp dev`). The command is public knowledge, a
 * name and never a value, so every member sees it; `canRun` says whether the
 * reader runs it themselves (owners and admins) or asks an admin to.
 */
export type SettingSetup = {
  canRun: boolean;
  command: string | null;
  devVars: readonly string[] | null;
};
