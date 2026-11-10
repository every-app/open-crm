import { Info, TriangleAlert } from "lucide-react";
import { SettingsCard, SettingsRow } from "@/client/components/SettingsSection";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import {
  COPY,
  notSetUpCopy,
  type ProviderStatus,
} from "@/client/features/mailbox/connectionCopy";
import { CodeBlock } from "@/client/features/settings/CodeBlock";

/**
 * While the gateway doesn't offer the provider there is nothing to connect
 * or reconnect: what is missing and who sets it, in the gateway's words, and
 * for owners and admins the command that does. A `warning` when a connected
 * mailbox waits on it.
 */
export function ProviderSetup({
  status,
  variant,
}: {
  status: ProviderStatus;
  variant?: "warning";
}) {
  const { name } = COPY[status.provider];
  return (
    <div className="space-y-3">
      <Alert variant={variant}>
        {variant ? <TriangleAlert aria-hidden /> : <Info aria-hidden />}
        <AlertTitle>
          {status.setup ?? notSetUpCopy(name, status.settings)}
        </AlertTitle>
      </Alert>
      {status.command ? (
        <SettingsCard>
          <SettingsRow stacked label="Command">
            <CodeBlock value={status.command} successMessage="Copied." />
          </SettingsRow>
        </SettingsCard>
      ) : null}
    </div>
  );
}
