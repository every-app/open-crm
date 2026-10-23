import { BellRing, Check } from "lucide-react";
import { cn } from "cn";

/** A next action finding its place on the calendar. */
export function FollowUpIllustration() {
  return (
    <div
      aria-hidden
      className="pointer-events-none relative h-60 w-80 max-w-full select-none sm:h-64 sm:w-96"
    >
      <div className="absolute inset-10 rounded-full bg-primary/10 blur-3xl" />

      <div className="absolute top-6 left-1/2 w-48 -translate-x-1/2 -rotate-6 rounded-2xl border border-border bg-card shadow-xl shadow-primary/5 sm:w-52">
        <div className="relative rounded-t-2xl border-b border-primary/10 bg-primary/8 px-5 py-5">
          <div className="absolute -top-2 left-6 h-5 w-1.5 rounded-full bg-primary/40" />
          <div className="absolute -top-2 right-6 h-5 w-1.5 rounded-full bg-primary/40" />
          <div className="h-2 w-16 rounded-full bg-primary/30" />
        </div>
        <div className="grid grid-cols-7 gap-2 p-5">
          {Array.from({ length: 21 }, (_, index) => (
            <div
              key={index}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md",
                index === 10
                  ? "scale-150 bg-primary text-primary-foreground shadow-sm"
                  : "bg-foreground/6",
              )}
            >
              {index === 10 ? (
                <Check className="size-3" strokeWidth={3} />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute top-14 left-1 z-10 flex size-16 -rotate-12 items-center justify-center rounded-2xl border border-border bg-card shadow-lg shadow-foreground/5 sm:left-5">
        <BellRing className="size-8 text-amber-500" strokeWidth={1.5} />
      </div>

      <div className="absolute right-0 bottom-6 z-10 flex w-40 rotate-6 items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg shadow-foreground/5 sm:right-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" strokeWidth={2} />
        </span>
        <div className="space-y-2">
          <div className="h-1.5 w-16 rounded-full bg-foreground/15" />
          <div className="h-1.5 w-10 rounded-full bg-foreground/8" />
        </div>
      </div>
    </div>
  );
}
