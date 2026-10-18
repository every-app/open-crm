import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { Globe, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { FormDialog } from "@/client/components/FormDialog";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import {
  SettingsCard,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { useTrackingMutation } from "@/client/features/tracking/trackingQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import type { TrackingSettings } from "@/server/features/tracking/services/TrackingSettingsService";
import {
  addTrackedDomain,
  removeTrackedDomain,
} from "@/serverFunctions/tracking";
import {
  DOMAIN_SCOPE_LABELS,
  DOMAIN_SCOPES,
  type DomainScope,
} from "@/shared/tracking";
import {
  addTrackedDomainSchema,
  type AddTrackedDomainInput,
} from "@/types/schemas/tracking";

/** The hosts the script records on. Owners and admins add and remove them. */
export function TrackingDomains({
  settings,
  canManage,
}: {
  settings: TrackingSettings;
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const remove = useTrackingMutation(
    (id: string) => removeTrackedDomain({ data: { id } }),
    () => toast.success("Domain removed."),
  );

  return (
    <SettingsSection
      title="Allowed domains"
      action={
        <Button disabled={!canManage} onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Add domain
        </Button>
      }
    >
      <SettingsCard>
        {settings.domains.length === 0 ? (
          <EmptyState
            icon={Globe}
            media="rows"
            variant="plain"
            title="Add a domain to get your tracking script"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Page views</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.domains.map((domain) => (
                <TableRow key={domain.id}>
                  <TableCell className="font-mono">{domain.host}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {DOMAIN_SCOPE_LABELS[domain.scope]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {domain.pageViews.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {domain.lastSeenAt ? (
                      <RelativeTime date={domain.lastSeenAt} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <InlineConfirm
                        label={`Remove ${domain.host}`}
                        pending={remove.isPending}
                        onConfirm={() => remove.mutate(domain.id)}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>
      {adding ? <AddDomainDialog onClose={() => setAdding(false)} /> : null}
    </SettingsSection>
  );
}

const FORM_ID = "add-tracked-domain";

const SCOPE_ITEMS = DOMAIN_SCOPES.map((scope) => ({
  value: scope,
  label: DOMAIN_SCOPE_LABELS[scope],
}));

function AddDomainDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (input: AddTrackedDomainInput) =>
      addTrackedDomain({ data: input }),
    // The form shows a taken or unreadable domain on the field itself.
    meta: { errorToast: false },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tracking"] });
      toast.success("Domain added.");
      onClose();
    },
  });
  const defaultValues: { host: string; scope: DomainScope } = {
    host: "",
    scope: "SITE_AND_SUBDOMAINS",
  };
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: addTrackedDomainSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await add.mutateAsync(value);
      } catch (error) {
        const code = getErrorCode(error);
        if (code === "CONFLICT" || code === "VALIDATION_ERROR") {
          formApi.setErrorMap({
            onSubmit: {
              fields: {
                host:
                  code === "CONFLICT"
                    ? "That domain is already on the list."
                    : "Enter a domain, like acme.com.",
              },
            },
          });
        } else {
          toast.error(getStandardErrorMessage(error));
        }
      }
    },
  });

  return (
    <form.AppForm>
      <FormDialog
        title="Add domain"
        onClose={onClose}
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={FORM_ID}>Add</form.SubmitButton>
          </>
        }
      >
        <form.Form id={FORM_ID} className="space-y-4">
          <form.AppField name="host">
            {(field) => (
              <field.TextField
                label="Domain"
                placeholder="acme.com"
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            )}
          </form.AppField>
          <form.AppField name="scope">
            {(field) => <field.SelectField label="Scope" items={SCOPE_ITEMS} />}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}
