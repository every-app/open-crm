import { useState } from "react";
import { Link, type LinkOptions } from "@tanstack/react-router";
import { ArrowRight, Building2, Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { ImportDialog } from "@/client/features/csv/ImportDialog";
import { recordKey } from "@/client/features/records/recordStack";
import { CompanyWelcomeIllustration } from "./CompanyWelcomeIllustration";

/** Home's next useful action, using the same fresh data as its figures. */
export function GetStartedCard({
  company,
  hasDeals,
  prominent,
}: {
  company: { id: string; name: string } | null;
  hasDeals: boolean;
  prominent: boolean;
}) {
  const [importing, setImporting] = useState(false);
  const link: LinkOptions = company
    ? {
        to: "/companies",
        search: {
          record: recordKey({ kind: "company", id: company.id }),
          add: "deal",
        },
      }
    : { to: "/companies", search: { new: true } };
  return (
    <>
      <section
        aria-labelledby="get-started-title"
        className={cn(
          "flex rounded-xl border border-border bg-card",
          prominent
            ? "min-h-[30rem] flex-1 flex-col items-center justify-center gap-7 px-6 py-12 text-center sm:min-h-[36rem] sm:rounded-2xl sm:px-12"
            : "flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        {prominent ? (
          <CompanyWelcomeIllustration deal={Boolean(company)} />
        ) : null}
        <div className={cn("space-y-1", prominent && "max-w-md space-y-3")}>
          {company ? (
            <p className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary/5 px-3 py-1.5 text-sm text-primary">
              <Building2 className="size-4 shrink-0" />
              <span className="truncate">{company.name}</span>
              <Check className="size-3.5 shrink-0" />
            </p>
          ) : null}
          <h2
            id="get-started-title"
            className={cn(
              "font-semibold",
              prominent && "text-2xl tracking-tight sm:text-3xl",
            )}
          >
            {company
              ? hasDeals
                ? "Start your next deal"
                : "Add your first deal"
              : "Add your first company"}
          </h2>
        </div>
        <div className={cn("flex flex-col gap-2", prominent && "items-center")}>
          <Button
            nativeButton={false}
            render={<Link {...link} />}
            size={prominent ? "lg" : "default"}
            className={prominent ? undefined : "self-start sm:shrink-0"}
          >
            {company ? "Add deal" : "Add company"}
            <ArrowRight data-icon="inline-end" />
          </Button>
          {prominent ? (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
              {!company ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setImporting(true)}
                >
                  Import CSV
                </Button>
              ) : null}
              <Button
                variant="link"
                size="sm"
                nativeButton={false}
                render={<Link to="/settings/connections" hash="ai-clients" />}
              >
                Connect AI client
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      {importing ? (
        <ImportDialog entity="COMPANY" onClose={() => setImporting(false)} />
      ) : null}
    </>
  );
}
