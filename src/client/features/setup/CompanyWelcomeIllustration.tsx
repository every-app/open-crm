import { Building2, Check, CircleDollarSign, UserRound } from "lucide-react";

/** A company at the center of its people and deals. */
export function CompanyWelcomeIllustration({
  deal = false,
}: {
  deal?: boolean;
}) {
  const MainIcon = deal ? CircleDollarSign : Building2;
  const RelatedIcon = deal ? Building2 : CircleDollarSign;
  return (
    <div
      aria-hidden
      className="pointer-events-none relative h-60 w-80 max-w-full select-none sm:h-64 sm:w-96"
    >
      <div className="absolute inset-10 rounded-full bg-primary/10 blur-3xl" />

      <div className="absolute top-6 left-1/2 z-10 w-44 -translate-x-1/2 -rotate-6 rounded-2xl border border-border bg-card p-5 shadow-xl shadow-primary/5 sm:w-48">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MainIcon className="size-7" strokeWidth={1.5} />
        </div>
        <div className="mt-5 h-2 w-24 rounded-full bg-foreground/15" />
        <div className="mt-2 h-1.5 w-16 rounded-full bg-foreground/8" />
        <div className="mt-5 flex gap-1.5 border-t border-border pt-3">
          <div className="h-1.5 w-8 rounded-full bg-primary/20" />
          <div className="h-1.5 w-8 rounded-full bg-primary/10" />
          <div className="h-1.5 w-5 rounded-full bg-primary/10" />
        </div>
      </div>

      <div className="absolute top-20 left-0 z-20 w-28 -rotate-12 rounded-xl border border-border bg-card p-3.5 shadow-lg shadow-foreground/5 sm:left-2">
        <div className="flex size-9 items-center justify-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400">
          <UserRound className="size-5" strokeWidth={1.5} />
        </div>
        <div className="mt-3 h-1.5 w-14 rounded-full bg-foreground/12" />
        <div className="mt-2 h-1.5 w-9 rounded-full bg-foreground/6" />
      </div>

      <div className="absolute right-0 bottom-5 z-20 w-32 rotate-8 rounded-xl border border-border bg-card p-3.5 shadow-lg shadow-foreground/5 sm:right-1">
        <div className="flex items-center justify-between">
          <RelatedIcon className="size-6 text-primary" strokeWidth={1.5} />
          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" strokeWidth={2} />
          </span>
        </div>
        <div className="mt-3 h-1.5 w-16 rounded-full bg-foreground/12" />
        <div className="mt-3 h-1.5 w-full rounded-full bg-primary/10">
          <div className="h-full w-2/3 rounded-full bg-primary/40" />
        </div>
      </div>
    </div>
  );
}
