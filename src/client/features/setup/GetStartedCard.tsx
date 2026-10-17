import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkOptions } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "cn";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Button, buttonVariants } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { getStartedQueryOptions } from "./setupQueries";
import { STEP_ILLUSTRATIONS } from "./StepIllustrations";

type StepId = keyof typeof STEP_ILLUSTRATIONS;

const STEPS: Record<
  StepId,
  { title: string; description: string; link: LinkOptions | "gateway" }
> = {
  model: {
    title: "Connect the agent's model",
    description: "The model the research agent thinks with.",
    link: { to: "/settings" },
  },
  context: {
    title: "Turn on company research",
    description: "So the agents can research every company in the CRM.",
    link: { to: "/settings" },
  },
  companies: {
    title: "Add your companies",
    description: "Import a CSV, or add the first one by hand.",
    link: { to: "/companies" },
  },
  inbox: {
    title: "Connect your inbox",
    description: "Emails, meetings and the people on them.",
    link: { to: "/settings/connections" },
  },
  agent: {
    title: "Build a team agent",
    description: "Describe a task to automate in Chat.",
    link: { to: "/chat" },
  },
  tracking: {
    title: "Track your website",
    description: "See visitors, and add contacts when a form is submitted.",
    link: { to: "/settings/tracking" },
  },
  slack: {
    title: "Connect Slack",
    description: "Messages to approved channels and people.",
    link: { to: "/settings/connections/slack" },
  },
  team: {
    title: "Invite your team",
    description: "Teammates join through Every App.",
    link: "gateway",
  },
};

// Folded away in this browser: the header and its progress stay.
const COLLAPSED_KEY = "open-crm:get-started-collapsed";

/**
 * Overview's Get started card: the next three steps as cards, how many are
 * done, and the done ones folded underneath. Gone once every step is done.
 */
export function GetStartedCard() {
  const query = useQuery(getStartedQueryOptions());
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const steps = query.data?.steps ?? [];
  const done = steps.filter((step) => step.done);
  const next = steps.filter((step) => !step.done).slice(0, 3);
  if (next.length === 0) return null;

  const toggle = () => {
    const value = !collapsed;
    setCollapsed(value);
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  };

  return (
    <section
      aria-labelledby="get-started-title"
      className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <h2
          id="get-started-title"
          className="text-xl font-semibold tracking-tight"
        >
          Get started
        </h2>
        <div className="flex items-center gap-3">
          <ProgressRing done={done.length} total={steps.length} />
          <span className="text-sm whitespace-nowrap">
            {done.length} of {steps.length} completed
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls="get-started-steps"
            aria-label={collapsed ? "Show the steps" : "Hide the steps"}
            onClick={toggle}
          >
            <ChevronUp
              className={cn("transition-transform", collapsed && "rotate-180")}
            />
          </Button>
        </div>
      </header>

      {collapsed ? null : (
        <div id="get-started-steps">
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            {next.map((step) => (
              <StepCard
                key={step.id}
                id={step.id}
                number={steps.indexOf(step) + 1}
              />
            ))}
          </ol>
          {done.length > 0 ? (
            <Collapsible className="mt-4">
              <CollapsibleTrigger className="group flex items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Check className="size-4 text-success" aria-hidden />
                {done.length} completed
                <ChevronRight
                  className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90"
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-3 space-y-2">
                  {done.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="size-4 text-success" aria-hidden />
                      {STEPS[step.id].title}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      )}
    </section>
  );
}

function StepCard({ id, number }: { id: StepId; number: number }) {
  const step = STEPS[id];
  const Illustration = STEP_ILLUSTRATIONS[id];
  return (
    <li className="relative overflow-hidden rounded-xl bg-foreground/[0.04] md:min-h-56 dark:bg-foreground/[0.06]">
      <StepLink link={step.link}>
        <span className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-sm font-medium shadow-xs">
            {number}
          </span>
          <span className="min-w-0 space-y-1 pt-1">
            <span className="block leading-tight font-semibold">
              {step.title}
            </span>
            <span className="block text-sm text-muted-foreground">
              {step.description}
            </span>
          </span>
        </span>
        <span className="hidden md:contents">
          <Illustration />
        </span>
        <span
          aria-hidden
          className={cn(
            buttonVariants({ size: "icon" }),
            "relative ml-auto shrink-0 group-hover/step:bg-primary/80 md:mt-auto md:ml-0",
          )}
        >
          <ArrowRight />
        </span>
      </StepLink>
    </li>
  );
}

// A row on phones; from md up, a tall card with the picture and the arrow
// at its foot.
const STEP_LINK_CLASS =
  "group/step flex h-full items-center gap-4 rounded-xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-56 md:flex-col md:items-stretch md:p-5";

/** The whole card is the step's link; the gateway's own page for invites. */
function StepLink({
  link,
  children,
}: {
  link: LinkOptions | "gateway";
  children: ReactNode;
}) {
  const account = useQuery({
    ...everyAppAccountQueryOptions(),
    enabled: link === "gateway",
  });
  if (link !== "gateway") {
    return (
      <Link {...link} className={STEP_LINK_CLASS}>
        {children}
      </Link>
    );
  }
  const gatewayUrl = account.data?.gatewayUrl;
  return gatewayUrl ? (
    <a
      href={`${gatewayUrl}/admin/users`}
      target="_blank"
      rel="noreferrer"
      className={STEP_LINK_CLASS}
    >
      {children}
    </a>
  ) : (
    <Link to="/settings/members" className={STEP_LINK_CLASS}>
      {children}
    </Link>
  );
}

/** A ring that fills as steps are done. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const share = total === 0 ? 0 : done / total;
  return (
    <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="3"
        className="stroke-foreground/10"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - share)}
        className="stroke-primary transition-[stroke-dashoffset]"
      />
    </svg>
  );
}
