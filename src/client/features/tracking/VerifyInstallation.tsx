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
export function VerifyInstallation({ canManage }: { canManage: boolean }) {
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
                  description="The page has to be public."
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
                    Check
                  </form.SubmitButton>
                )}
              </form.Subscribe>
            </SettingsCardFooter>
          </SettingsCard>
        </form.Form>
      </form.AppForm>
      {result ? <Outcome result={result} /> : null}
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

function Outcome({ result }: { result: VerifyResult }) {
  if (result.status === "unreachable") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Could not open {result.host}</AlertTitle>
        <AlertDescription>
          {result.detail} We only follow public pages, never a redirect to a
          private address.
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
          Check that it sits in the head, above anything that rewrites the page.
          {result.containers.length > 0
            ? ` It isn't in Tag Manager container ${result.containers.join(" or ")} either.`
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
          Container {result.container.id} carries the tag without the site ID in
          its URL, so the tracker never starts. Replace the tag&apos;s HTML with
          the Tag Manager snippet above.
          {result.pageView
            ? " Something on this site still sent a page view in the last five minutes."
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
        This domain is {result.allowed ? "on" : "not on"} the allow list.
        {result.pageView
          ? ""
          : " Open the page in a browser to send a page view."}
      </AlertDescription>
    </Alert>
  );
}
