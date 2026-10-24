import { SettingsRow } from "@/client/components/SettingsSection";
import { CodeBlock } from "@/client/features/settings/CodeBlock";

/**
 * A provider the Every App gateway holds no OAuth client for: the redirect
 * URI to register, then the command that gives the gateway the client (a
 * deployment) or the .dev.vars names to put it under (local development).
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
        <SettingsRow stacked label="Command">
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
