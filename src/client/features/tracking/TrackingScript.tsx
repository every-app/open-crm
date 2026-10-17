import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { CopyButton } from "@/client/components/CopyButton";
import { SectionHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { SettingSwitch } from "@/client/features/tracking/TrackingOptions";
import { useTrackingMutation } from "@/client/features/tracking/trackingQueries";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import type { TrackingSettings } from "@/server/features/tracking/services/TrackingSettingsService";
import {
  rotateTrackingSiteId,
  setTrackingFlag,
} from "@/serverFunctions/tracking";

function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 rounded-md border bg-muted p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap">
        {code}
      </pre>
      <CopyButton value={code} successMessage="Script copied" label={label} />
    </div>
  );
}

function Status({ settings }: { settings: TrackingSettings }) {
  if (settings.paused) return <Badge variant="warning">Paused</Badge>;
  if (settings.receivingSince) {
    return (
      <Badge variant="success">
        Last page view <RelativeTime date={settings.receivingSince} />
      </Badge>
    );
  }
  return <Badge variant="outline">No page views yet</Badge>;
}

/**
 * The tag to paste (or add through Tag Manager), pausing, and rotating the
 * site id when a snippet must stop everywhere at once.
 */
export function TrackingScript({
  settings,
  siteId,
}: {
  settings: TrackingSettings;
  siteId: string;
}) {
  const [rotating, setRotating] = useState(false);
  const pause = useTrackingMutation(
    (paused: boolean) =>
      setTrackingFlag({ data: { flag: "paused", enabled: paused } }),
    (paused) =>
      toast.success(
        paused
          ? "Tracking paused. Websites stop recording within five minutes."
          : "Tracking resumed.",
      ),
  );
  const rotate = useTrackingMutation(
    () => rotateTrackingSiteId(),
    () => {
      setRotating(false);
      toast.success("Site ID rotated. Paste the new tag on your website.");
    },
  );

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Tracking script"
        action={<Status settings={settings} />}
      />
      <p className="text-sm text-muted-foreground">
        One tag, under 4 KB, in the head of every page you want to measure. It
        records page views and outbound clicks, and adds a contact when someone
        submits a form with their email address.
      </p>
      <Tabs defaultValue="html">
        <TabsList>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="gtm">Google Tag Manager</TabsTrigger>
        </TabsList>
        <TabsContent value="html" className="space-y-2 pt-2">
          {settings.snippet ? (
            <Snippet code={settings.snippet} label="Copy" />
          ) : null}
          <p className="text-xs text-muted-foreground">
            Site ID <span className="font-mono text-foreground">{siteId}</span>.
            Rotating it stops every copy of the old script at once.
          </p>
        </TabsContent>
        <TabsContent value="gtm" className="space-y-2 pt-2">
          {settings.tagManagerSnippet ? (
            <Snippet code={settings.tagManagerSnippet} label="Copy" />
          ) : null}
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            <li>In Tag Manager, add a new Custom HTML tag.</li>
            <li>
              Paste this snippet, not the HTML one, as the tag&apos;s HTML.
            </li>
            <li>Trigger it on All Pages, then publish the container.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Tag Manager drops a <span className="font-mono">data-site</span>{" "}
            attribute when it injects a script, so this one carries the site ID
            in its URL instead.
          </p>
        </TabsContent>
      </Tabs>
      <div className="space-y-3">
        <SettingSwitch
          label="Pause tracking"
          hint="The script keeps loading and records nothing. Your domains and settings are kept."
          checked={settings.paused}
          pending={pause.isPending}
          onChange={(paused) => pause.mutate(paused)}
        />
        <Button variant="outline" size="sm" onClick={() => setRotating(true)}>
          Rotate site ID
        </Button>
      </div>
      {rotating ? (
        <ConfirmDialog
          title="Rotate the site ID?"
          confirmLabel="Rotate"
          destructive
          pending={rotate.isPending}
          onClose={() => setRotating(false)}
          onConfirm={() => rotate.mutate(undefined)}
        >
          Every copy of the old script stops recording, including any you have
          forgotten about. You will need to paste the new tag on every page that
          carries the old one. Nothing already collected is lost.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
