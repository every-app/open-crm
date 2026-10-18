import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  SettingsCard,
  SettingsSection,
} from "@/client/components/SettingsSection";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
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
 * The tag, one way to install it at a time as the original CRM folds them
 * (pasted into the HTML, or added through Tag Manager), and pausing it.
 * Every member can copy it; owners and admins pause it.
 */
export function TrackingScript({
  settings,
  canManage,
}: {
  settings: TrackingSettings;
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
      description="In the head of every page you measure."
    >
      <SettingsCard>
        <Accordion defaultValue={["html"]}>
          <InstallMethod
            value="html"
            label="Paste it into your HTML"
            snippet={settings.snippet}
          />
          <InstallMethod
            value="gtm"
            label="Add it through Google Tag Manager"
            snippet={settings.tagManagerSnippet}
          >
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>In Tag Manager, add a new Custom HTML tag.</li>
              <li>
                Paste this snippet — not the one above — as the tag&apos;s HTML.
              </li>
              <li>Trigger it on All Pages, then publish the container.</li>
            </ol>
          </InstallMethod>
        </Accordion>
        <SwitchRow
          label="Pause tracking"
          hint="The script keeps loading and records nothing."
          checked={settings.paused}
          disabled={!canManage || pause.isPending}
          onChange={(paused) => pause.mutate(paused)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

/** One way to install the tag: a row that opens onto its snippet. */
function InstallMethod({
  value,
  label,
  snippet,
  children,
}: {
  value: "html" | "gtm";
  label: string;
  snippet: string | null;
  children?: ReactNode;
}) {
  return (
    <AccordionItem value={value} className="px-5">
      <AccordionTrigger className="border-0 py-4">{label}</AccordionTrigger>
      <AccordionContent className="space-y-3 pb-4">
        {snippet ? (
          <CodeBlock value={snippet} successMessage="Script copied." />
        ) : null}
        {children}
      </AccordionContent>
    </AccordionItem>
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
          Every copy of the old script stops recording at once.
        </ConfirmDialog>
      ) : null}
    </DangerZone>
  );
}
