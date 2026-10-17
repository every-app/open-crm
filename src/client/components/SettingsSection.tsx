import type { ReactNode } from "react";
import { cn } from "cn";
import { PageHeader } from "@/client/components/PageHeader";

// Settings pages are titled sections of cards, and each card is a stack of
// rows: what the setting is on the left, its control on the right.

/** One settings page: its title, then its sections. */
export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-4 pt-6 pb-24 md:px-10 md:pt-10 md:pb-12">
      <div className="mx-auto max-w-3xl space-y-10">
        <PageHeader title={title} description={description} actions={actions} />
        {children}
      </div>
    </div>
  );
}

/** A titled group of settings: one or more `SettingsCard`s. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** A control beside the title, such as a "New" button for a table. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A card of settings rows, divided by hairlines. */
export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One setting: its name and what it does on the left, its control on the
 * right. Below `sm` the control drops under the text. Pass `htmlFor` when
 * the control is a single field, so the name labels it.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  stacked = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  /** The control: a field, a select, a switch, a button or a status. */
  children?: ReactNode;
  /** Put the control under the text at every width, for wide controls. */
  stacked?: boolean;
}) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-5 py-4",
        !stacked && "sm:flex-row sm:items-center sm:justify-between sm:gap-8",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
        </Label>
        {description ? (
          <div className="text-sm text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? (
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            !stacked && "sm:shrink-0 sm:justify-end",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A strip under a card's rows for its Save button and the like. */
export function SettingsCardFooter({
  children,
  note,
}: {
  children: ReactNode;
  /** A short line on the left, such as who may change the card. */
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-foreground/[0.02] px-5 py-3">
      <div className="min-w-0 text-sm text-muted-foreground">{note}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
