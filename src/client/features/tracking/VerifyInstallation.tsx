import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  SettingsCard,
  SettingsCardFooter,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { TitleWithStatus } from "@/client/features/settings/ConnectionStatus";
import type { VerifyResult } from "@/server/features/tracking/services/TrackingSettingsService";
import { verifyTracking } from "@/serverFunctions/tracking";
import { verifyTrackingSchema } from "@/types/schemas/tracking";

/**
 * Loads one public page from the server and looks for the tag, then in the
 * page's Tag Manager containers when the HTML has none. Owners and admins
 * run it.
 */
export function VerifyInstallation({
  siteId,
  canManage,
}: {
  siteId: string;
  canManage: boolean;
}) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const verify = useMutation({
    mutationFn: (url: string) => verifyTracking({ data: { url } }),
    onSuccess: setResult,
  });
  const form = useAppForm({
    defaultValues: { url: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: verifyTrackingSchema },
    onSubmit: async ({ value }) => {
      setResult(null);
      await verify.mutateAsync(value.url).catch(() => {});
    },
  });

  return (
    <SettingsSection
      title={
        <TitleWithStatus status={result ? <Indicator result={result} /> : null}>
          Verify installation
        </TitleWithStatus>
      }
      description="We load one page and look for the script, then read your Tag Manager container if it is not in the HTML."
    >
      <form.AppForm>
        <form.Form>
          <SettingsCard>
            <form.AppField
              name="url"
              listeners={{ onChange: () => setResult(null) }}
            >
              {(field) => (
                <field.RowTextField
                  label="Page to check"
                  description="The page has to be public. A page behind a login always fails this check."
                  prefix="https://"
                  placeholder="acme.com/pricing"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={!canManage}
                />
              )}
            </form.AppField>
            <SettingsCardFooter>
              <form.Subscribe selector={(state) => state.values.url}>
                {(url) => (
                  <form.SubmitButton disabled={!canManage || url.trim() === ""}>
                    Check now
                  </form.SubmitButton>
                )}
              </form.Subscribe>
            </SettingsCardFooter>
          </SettingsCard>
        </form.Form>
      </form.AppForm>
      {result ? <Outcome result={result} siteId={siteId} /> : null}
    </SettingsSection>
  );
}

function Indicator({ result }: { result: VerifyResult }) {
  if (result.status === "found" && result.pageView) {
    return <Badge variant="success">Verified just now</Badge>;
  }
  if (result.status === "found" && result.container?.carriesSiteId === false) {
    return <Badge variant="warning">Tag Manager needs a fix</Badge>;
  }
  return (
    <Badge variant="warning">
      {result.status === "found" ? "No page view yet" : "Not detected"}
    </Badge>
  );
}

function Outcome({ result, siteId }: { result: VerifyResult; siteId: string }) {
  if (result.status === "unreachable") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Could not open {result.host}</AlertTitle>
        <AlertDescription>
          {result.detail} We only follow public pages, and we never follow a
          redirect to a private address.
        </AlertDescription>
      </Alert>
    );
  }
  if (result.status === "missing") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>No script on {result.host}</AlertTitle>
        <AlertDescription>
          The page answered in {result.responseMs} ms, but the tag was not in
          the HTML. Check that it sits in the head, above anything that rewrites
          the page.
          {result.containers.length > 0
            ? ` We also read Tag Manager container ${result.containers.join(" and ")}, and the tag is not in there either.`
            : ""}
        </AlertDescription>
      </Alert>
    );
  }
  if (result.container && !result.container.carriesSiteId) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Tag Manager will drop the site ID</AlertTitle>
        <AlertDescription>
          Container {result.container.id} carries the tag, but the site ID is
          not in the script URL. Tag Manager keeps only the URL when it injects
          a script, so a data-site attribute never reaches the page and the
          tracker never starts. Copy the Tag Manager snippet above and replace
          the tag&apos;s HTML.
          {result.pageView
            ? " A page view did arrive in the last five minutes, so something on this site is still recording."
            : ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <CircleCheck className="text-success" />
      <AlertTitle>
        {result.container
          ? `Script found in container ${result.container.id}`
          : `Script found on ${result.host}`}
      </AlertTitle>
      <AlertDescription>
        It answered in {result.responseMs} ms. Site ID {siteId} matched, and
        this domain is {result.allowed ? "on" : "not on"} the allow list.
        {result.container
          ? " The tag is not in the HTML, so it only runs once Tag Manager fires it — a page view is the proof."
          : ""}
        {result.pageView
          ? " A page view arrived in the last five minutes."
          : " No page view has arrived yet — open the page in a browser to send one."}
      </AlertDescription>
    </Alert>
  );
}
