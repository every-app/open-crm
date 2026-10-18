import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/client/components/QueryState";
import { SettingsPage } from "@/client/components/SettingsSection";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { TrackingDomains } from "@/client/features/tracking/TrackingDomains";
import {
  TrackingCookies,
  TrackingRules,
  TrafficSources,
} from "@/client/features/tracking/TrackingOptions";
import {
  RotateSiteId,
  TrackingScript,
} from "@/client/features/tracking/TrackingScript";
import { VerifyInstallation } from "@/client/features/tracking/VerifyInstallation";
import { trackingSettingsQueryOptions } from "@/client/features/tracking/trackingQueries";

/**
 * Settings → Tracking & Analytics: the script for the organization's
 * website, which records page views and turns form submissions into
 * contacts. Every member sees it and copies the script; owners and admins
 * change it, verify it and see traffic sources.
 */
export function TrackingSettings() {
  const canManage = useCanManageWorkspace();
  const query = useQuery(trackingSettingsQueryOptions());

  return (
    <SettingsPage title="Tracking & Analytics">
      <QueryState
        query={query}
        errorFallback="The tracking settings could not be loaded."
      >
        {(settings) =>
          settings.ready && settings.siteId ? (
            <>
              <TrackingScript settings={settings} canManage={canManage} />
              <VerifyInstallation canManage={canManage} />
              {canManage ? <TrafficSources /> : null}
              <TrackingRules settings={settings} canManage={canManage} />
              <TrackingDomains settings={settings} canManage={canManage} />
              <TrackingCookies settings={settings} canManage={canManage} />
              {canManage ? <RotateSiteId /> : null}
            </>
          ) : (
            <>
              <TrackingDomains settings={settings} canManage={canManage} />
              <TrackingRules settings={settings} canManage={canManage} />
            </>
          )
        }
      </QueryState>
    </SettingsPage>
  );
}
