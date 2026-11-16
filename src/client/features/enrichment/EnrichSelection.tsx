import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { chunk } from "remeda";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import { enrichmentSettingsQueryOptions } from "@/client/features/enrichment/enrichmentQueries";
import type { RecordNoun } from "@/client/features/records/RecordBulkMenu";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { enrichCompanies, enrichContacts } from "@/serverFunctions/enrichment";
import {
  ENRICHMENT_PROVIDER_NAMES,
  ENRICHMENT_RUN_SIZE,
  type EnrichmentKind,
  type EnrichmentRecordResult,
  type EnrichmentRunResult,
} from "@/shared/enrichment";

// Enrich, in a list's Actions menu: the selected rows are looked up with the
// workspace's provider, a few at a time, while the page stays open. A toast
// counts them off and then says how it went. Closing the page stops it:
// nothing carries on in the background.

const RUN = {
  contact: enrichContacts,
  company: enrichCompanies,
} as const satisfies Record<EnrichmentKind, unknown>;

const countOf = (count: number, noun: RecordNoun) =>
  `${count.toLocaleString()} ${count === 1 ? noun.one : noun.many}`;

/** How a finished run went, as its toast says it. */
function enrichmentSummary(
  results: EnrichmentRecordResult[],
  noun: RecordNoun,
  providerName: string,
): { tone: "success" | "warning"; title: string; description?: string } {
  const count = (outcome: EnrichmentRecordResult["outcome"]) =>
    results.filter((result) => result.outcome === outcome).length;
  const enriched = count("enriched");
  const rest = [
    count("nothing") > 0 ? `${count("nothing")} had nothing new` : null,
    count("skipped") > 0 ? `${count("skipped")} skipped` : null,
    count("failed") > 0 ? `${count("failed")} failed` : null,
  ].filter((part) => part !== null);
  // Why the first record that wasn't looked up wasn't, a failure first.
  const why =
    results.find((result) => result.outcome === "failed")?.reason ??
    results.find((result) => result.outcome === "skipped")?.reason;
  const description =
    [rest.join(", "), why].filter(Boolean).join(": ") || undefined;
  if (enriched === 0) {
    return {
      tone: "warning",
      title: `${providerName} filled nothing in.`,
      description,
    };
  }
  return {
    tone: rest.length > 0 ? "warning" : "success",
    title: `${countOf(enriched, noun)} enriched with ${providerName}.`,
    description,
  };
}

/** Enriches a selection of one kind of record, reporting as it goes. */
export function useEnrichSelection(
  kind: EnrichmentKind,
  noun: RecordNoun,
  onDone: () => void,
) {
  const invalidate = useInvalidateRecords();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const toastId = toast.loading(`Enriching ${countOf(ids.length, noun)}…`);
      const results: EnrichmentRecordResult[] = [];
      try {
        let last: EnrichmentRunResult | undefined;
        for (const run of chunk(ids, ENRICHMENT_RUN_SIZE)) {
          last = await RUN[kind]({ data: { ids: run } });
          results.push(...last.results);
          toast.loading(
            `Enriching ${countOf(ids.length, noun)}… ${results.length.toLocaleString()} done`,
            { id: toastId },
          );
        }
        return { toastId, results, provider: last?.provider };
      } catch (error) {
        toast.error(getStandardErrorMessage(error), {
          id: toastId,
          description:
            results.length > 0
              ? `Stopped after ${countOf(results.length, noun)}.`
              : undefined,
        });
        throw error;
      }
    },
    // The run's own toast said what went wrong.
    meta: { errorToast: false },
    onSuccess: ({ toastId, results, provider }) => {
      if (!provider) return;
      const { tone, title, description } = enrichmentSummary(
        results,
        noun,
        ENRICHMENT_PROVIDER_NAMES[provider],
      );
      toast[tone](title, { id: toastId, description });
      onDone();
    },
    onSettled: () => invalidate(),
  });
}

/** The Actions menu's Enrich item, naming the provider a run would use. */
export function EnrichMenuItem({
  kind,
  onClick,
}: {
  kind: EnrichmentKind;
  onClick: () => void;
}) {
  const { data } = useQuery(enrichmentSettingsQueryOptions());
  const provider = data?.active[kind];
  return (
    <DropdownMenuItem onClick={onClick}>
      <Sparkles />
      {provider
        ? `Enrich with ${ENRICHMENT_PROVIDER_NAMES[provider]}`
        : "Enrich"}
    </DropdownMenuItem>
  );
}
