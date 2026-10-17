import { MutationCache, QueryClient } from "@tanstack/query-core";
import { toast } from "sonner";
import { showOutOfCredits } from "@/client/features/billing/outOfCredits";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";

declare module "@tanstack/query-core" {
  interface Register {
    mutationMeta: {
      // Set when the component shows the error itself (inline or in a catch).
      errorToast?: false;
    };
  }
}

export const queryClient = new QueryClient({
  // Every failed mutation shows a toast unless it has its own onError or opts
  // out through meta, so no failure is silent.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Out of credits (hosted billing) always opens the one dialog that
      // says how to get more, whoever handles the mutation's other errors.
      if (getErrorCode(error) === "INSUFFICIENT_CREDITS") {
        showOutOfCredits();
        return;
      }
      if (mutation.options.onError || mutation.meta?.errorToast === false) {
        return;
      }
      toast.error(getStandardErrorMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60,
      staleTime: 1000 * 60 * 5, // 5 minutes — show cached data instantly, refetch in background after
    },
  },
});
