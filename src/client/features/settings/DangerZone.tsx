import type { ReactNode } from "react";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";

/** A settings page's last section: its destructive actions, a row each. */
export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard>{children}</SettingsCard>
    </SettingsSection>
  );
}

/** One destructive action: what it does, and the button that starts it. */
export function DangerRow({
  label,
  description,
  action,
  pending = false,
  onClick,
}: {
  label: string;
  description: ReactNode;
  /** The button's label, the verb of the confirmation that follows. */
  action: string;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <Button
        variant="outline"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        pending={pending}
        onClick={onClick}
      >
        {action}
      </Button>
    </SettingsRow>
  );
}
