import { SettingsRow } from "@/client/components/SettingsSection";
import { CodeBlock } from "@/client/features/settings/CodeBlock";

/**
 * A provider the Every App gateway holds no OAuth client for: the redirect
 * URI to register, then the command that gives the gateway the client (a
 * fork) or the .dev.vars names to put it under (local development).
 */
export function GatewaySetupRows({
  redirectLabel = "Redirect URI",
  redirectUri,
  register,
  setup,
}: {
  redirectLabel?: string;
  redirectUri: string;
  /** Where to register the client, in one line. */
  register: string;
  setup: { command: string | null; devVars: readonly string[] | null };
}) {
  return (
    <>
      <SettingsRow stacked label={redirectLabel} description={register}>
        <CodeBlock value={redirectUri} />
      </SettingsRow>
      {setup.command ? (
        <SettingsRow
          stacked
          label="Command"
          description="Then give the client to your Every App gateway."
        >
          <CodeBlock value={setup.command} successMessage="Command copied" />
        </SettingsRow>
      ) : null}
      {setup.devVars ? (
        <SettingsRow
          stacked
          label=".dev.vars"
          description="Then put the client in .dev.vars and restart."
        >
          <CodeBlock
            value={setup.devVars.map((name) => `${name}=`).join("\n")}
          />
        </SettingsRow>
      ) : null}
    </>
  );
}
