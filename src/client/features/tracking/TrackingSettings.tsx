import { useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { TrackingDomains } from "@/client/features/tracking/TrackingDomains";
import {
  TrackingCookies,
  TrackingRules,
  TrafficSources,
} from "@/client/features/tracking/TrackingOptions";
import { TrackingScript } from "@/client/features/tracking/TrackingScript";
import { VerifyInstallation } from "@/client/features/tracking/VerifyInstallation";
import { trackingSettingsQueryOptions } from "@/client/features/tracking/trackingQueries";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/**
 * Settings → Tracking: the snippet for the organization's website, which
 * records page views and turns form submissions into contacts. Owners and
 * admins decide what runs on the website.
 */
export function TrackingSettings() {
  const workspace = useQuery(workspaceQueryOptions());
  if (!workspace.data) return null;
  if (!hasOrgPermission(workspace.data.role, { workspace: ["manage"] })) {
    return (
      <section className="space-y-3">
        <SectionHeader title="Website tracking" />
        <p className="max-w-2xl text-sm text-muted-foreground">
          Only an owner or an admin can set up website tracking. What a contact
          did on your website shows on their record once they submit a form.
        </p>
      </section>
    );
  }
  return <TrackingSections />;
}

function TrackingSections() {
  const query = useQuery(trackingSettingsQueryOptions());
  return (
    <QueryState
      query={query}
      errorFallback="The tracking settings could not be loaded."
    >
      {(settings) =>
        settings.ready && settings.siteId ? (
          <div className="space-y-10">
            <TrackingScript settings={settings} siteId={settings.siteId} />
            <VerifyInstallation />
            <TrafficSources />
            <TrackingRules settings={settings} />
            <TrackingDomains settings={settings} />
            <TrackingCookies settings={settings} />
          </div>
        ) : (
          <div className="space-y-10">
            <section className="space-y-3">
              <SectionHeader title="Website tracking" />
              <p className="max-w-2xl text-sm text-muted-foreground">
                Track visitors on your website and add a contact whenever
                someone submits a form. Add the domain your website runs on to
                get your tracking script.
              </p>
            </section>
            <TrackingDomains settings={settings} />
            <TrackingRules settings={settings} />
          </div>
        )
      }
    </QueryState>
  );
}
