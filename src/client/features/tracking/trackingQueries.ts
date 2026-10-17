import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getTrackingSettings,
  getTrafficSources,
  getWebsiteActivity,
} from "@/serverFunctions/tracking";
import type { WebsiteActivityInput } from "@/types/schemas/tracking";

/** The snippet, switches, allowed domains and totals (owners and admins). */
export const trackingSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["tracking", "settings"],
    queryFn: () => getTrackingSettings(),
  });

/** Page views and contacts per source (owners and admins). */
export const trafficSourcesQueryOptions = () =>
  queryOptions({
    queryKey: ["tracking", "sources"],
    queryFn: () => getTrafficSources(),
  });

/** What a contact's or company's identified browsers did on the website. */
export const websiteActivityQueryOptions = (record: WebsiteActivityInput) =>
  queryOptions({
    queryKey: ["tracking", "activity", record],
    queryFn: () => getWebsiteActivity({ data: record }),
  });

/** A settings change: the tracking queries load again once it lands. */
export function useTrackingMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  onSuccess?: (input: TInput) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: ["tracking"] });
      onSuccess?.(input);
    },
  });
}
