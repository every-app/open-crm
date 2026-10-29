import { SettingsRow } from "@/client/components/SettingsSection";
import { CodeBlock } from "@/client/features/settings/CodeBlock";
import { TOKEN_KEY_SETTING, type SettingSetup } from "@/shared/app-settings";

// What a connect page says while something it needs is unset. The manifest
// declares the OAuth clients and TOKEN_ENCRYPTION_KEY optional, so the
// gateway opens the CRM without them and this is where their absence shows:
// a sentence naming what an admin sets, never a failed request.

/** "Google isn't set up on this Every App gateway yet. An admin sets X and Y." */
export function notSetUpCopy(
  name: string,
  settings: readonly string[],
): string {
  return `${name} isn't set up on this Every App gateway yet. An admin sets ${settings.join(" and ")}.`;
}

/** The title of the card that stands in for Connect while the key is unset. */
export const TOKEN_KEY_TITLE = "Connections aren't set up on this CRM yet";

/**
 * The CRM holds no TOKEN_ENCRYPTION_KEY, so nothing connects: what it is,
 * and the command (a deployment) or the .dev.vars name (`everyapp dev`) that
 * sets it. Owners and admins run the command; a member sees the same one
 * under "Ask an admin to run", as the gateway's own setup dialog puts it.
 */
export function TokenKeyRows({ setup }: { setup: SettingSetup }) {
  return (
    <>
      <SettingsRow
        stacked
        label={TOKEN_KEY_SETTING}
        description={
          setup.canRun
            ? `Members' mail and calendar tokens are encrypted under it: 32 or more random characters (openssl rand -base64 32 makes one). Changing it later means everyone connects again.`
            : `Members' mail and calendar tokens are encrypted under it. An admin sets it on the CRM.`
        }
      />
      {setup.command ? (
        <SettingsRow
          stacked
          label={setup.canRun ? "Command" : "Ask an admin to run"}
        >
          <CodeBlock value={setup.command} successMessage="Copied." />
        </SettingsRow>
      ) : null}
      {setup.devVars ? (
        <SettingsRow stacked label=".dev.vars">
          <CodeBlock
            value={setup.devVars.map((name) => `${name}=`).join("\n")}
          />
        </SettingsRow>
      ) : null}
    </>
  );
}
