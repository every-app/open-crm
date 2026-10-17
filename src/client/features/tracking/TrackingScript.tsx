import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Badge } from "@/client/components/ui/badge";
import { CodeBlock } from "@/client/features/settings/CodeBlock";
import { TitleWithStatus } from "@/client/features/settings/ConnectionStatus";
import { DangerRow, DangerZone } from "@/client/features/settings/DangerZone";
import { SwitchRow } from "@/client/features/tracking/TrackingOptions";
import { useTrackingMutation } from "@/client/features/tracking/trackingQueries";
import type { TrackingSettings } from "@/server/features/tracking/services/TrackingSettingsService";
import {
  rotateTrackingSiteId,
  setTrackingFlag,
} from "@/serverFunctions/tracking";

function Status({ settings }: { settings: TrackingSettings }) {
  if (settings.paused) return <Badge variant="warning">Paused</Badge>;
  if (settings.receivingSince) {
    return <Badge variant="success">Receiving page views</Badge>;
  }
  return <Badge variant="outline">No page views yet</Badge>;
}

/**
 * The tag to paste, or to add through Tag Manager, and pausing it. Every
 * member can copy it; owners and admins pause it.
 */
export function TrackingScript({
  settings,
  siteId,
  canManage,
}: {
  settings: TrackingSettings;
  siteId: string;
  canManage: boolean;
}) {
  const pause = useTrackingMutation(
    (paused: boolean) =>
      setTrackingFlag({ data: { flag: "paused", enabled: paused } }),
    (paused) =>
      toast.success(
        paused
          ? "Tracking paused. The script stops recording within five minutes."
          : "Tracking resumed.",
      ),
  );

  return (
    <SettingsSection
      title={
        <TitleWithStatus status={<Status settings={settings} />}>
          Tracking script
        </TitleWithStatus>
      }
      description="One tag, 4 KB, in the head of every page you measure."
    >
      <SettingsCard>
        <SettingsRow stacked label="Paste it into your HTML">
          <div className="w-full space-y-2">
            {settings.snippet ? (
              <CodeBlock
                value={settings.snippet}
                successMessage="Script copied."
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Site ID{" "}
              <span className="font-mono text-foreground">{siteId}</span> ·
              Rotating it stops every copy of the old script at once.
            </p>
          </div>
        </SettingsRow>
        <SettingsRow stacked label="Add it through Google Tag Manager">
          <div className="w-full space-y-2">
            {settings.tagManagerSnippet ? (
              <CodeBlock
                value={settings.tagManagerSnippet}
                successMessage="Script copied."
              />
            ) : null}
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>In Tag Manager, add a new Custom HTML tag.</li>
              <li>
                Paste this snippet — not the one above — as the tag&apos;s HTML.
              </li>
              <li>
                Trigger it on All Pages, then publish the container. Keep{" "}
                <span className="font-mono text-foreground">
                  {settings.scriptUrl}
                </span>{" "}
                off any consent-blocked category you do not need.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Tag Manager drops a{" "}
              <span className="font-mono text-foreground">data-site</span>{" "}
              attribute when it injects a script, so this form carries the site
              ID in the URL instead.
            </p>
          </div>
        </SettingsRow>
        <SwitchRow
          label="Pause tracking"
          hint="The script keeps loading and records nothing. Your domains and settings are kept"
          checked={settings.paused}
          disabled={!canManage || pause.isPending}
          onChange={(paused) => pause.mutate(paused)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

/** The kill switch for a snippet that must stop everywhere at once. */
export function RotateSiteId() {
  const [rotating, setRotating] = useState(false);
  const rotate = useTrackingMutation(
    () => rotateTrackingSiteId(),
    () => {
      setRotating(false);
      toast.success("Site ID rotated. Paste the new tag on your website.");
    },
  );

  return (
    <DangerZone>
      <DangerRow
        label="Rotate site ID"
        description="Every copy of the old script stops recording at once."
        action="Rotate"
        pending={rotate.isPending}
        onClick={() => setRotating(true)}
      />
      {rotating ? (
        <ConfirmDialog
          title="Rotate the site ID?"
          confirmLabel="Rotate"
          destructive
          pending={rotate.isPending}
          onClose={() => setRotating(false)}
          onConfirm={() => rotate.mutate(undefined)}
        >
          Every copy of the old script stops recording at once, including any
          you have forgotten about. You will need to paste the new tag on every
          page that carries the old one. Nothing already collected is lost.
        </ConfirmDialog>
      ) : null}
    </DangerZone>
  );
}
