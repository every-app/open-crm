import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { CircleAlert, CircleCheck } from "lucide-react";
import { SectionHeader } from "@/client/components/PageHeader";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import type { VerifyResult } from "@/server/features/tracking/services/TrackingSettingsService";
import { verifyTracking } from "@/serverFunctions/tracking";
import { verifyTrackingSchema } from "@/types/schemas/tracking";

/**
 * Loads one public page from the server and looks for the tag, then in the
 * page's Tag Manager containers when the HTML has none.
 */
export function VerifyInstallation() {
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
    <section className="space-y-3">
      <SectionHeader title="Verify installation" />
      <p className="text-sm text-muted-foreground">
        We load one page and look for the script, then read your Tag Manager
        container if it is not in the HTML. The page has to be public and served
        over https.
      </p>
      <form.AppForm>
        <form.Form className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <form.AppField name="url">
              {(field) => (
                <field.TextField
                  label="Page to check"
                  placeholder="acme.com/pricing"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              )}
            </form.AppField>
          </div>
          <form.SubmitButton variant="outline">Check now</form.SubmitButton>
        </form.Form>
      </form.AppForm>
      {result ? <Outcome result={result} /> : null}
    </section>
  );
}

function Outcome({ result }: { result: VerifyResult }) {
  if (result.status === "unreachable") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Could not open {result.host}</AlertTitle>
        <AlertDescription>
          {result.httpStatus
            ? `The page answered ${result.httpStatus}.`
            : "We could not reach that page."}{" "}
          We only follow public https pages, and never a redirect to plain http.
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
      <Alert variant="warning">
        <CircleAlert />
        <AlertTitle>Tag Manager will drop the site ID</AlertTitle>
        <AlertDescription>
          Container {result.container.id} carries the tag, but the site ID is
          not in the script URL. Tag Manager keeps only the URL when it injects
          a script, so the tracker never starts. Copy the Google Tag Manager
          snippet above and replace the tag&apos;s HTML.
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
        It answered in {result.responseMs} ms and the site ID matched.{" "}
        {result.allowed
          ? "This domain is on the allow-list."
          : "This domain is not on the allow-list, so nothing it sends is recorded."}{" "}
        {result.pageView
          ? "A page view arrived in the last five minutes."
          : "No page view has arrived yet: open the page in a browser to send one."}
      </AlertDescription>
    </Alert>
  );
}
