import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import type { getBuilderChat } from "@/serverFunctions/teamAgents";
import { FileTabs, ManifestReview } from "./ManifestReview";
import { STATUS_COPY } from "./teamAgentCopy";

type Chat = Awaited<ReturnType<typeof getBuilderChat>>;

const STEPS = [
  { label: "Instructions", path: "agent/instructions.md" },
  { label: "Manifest", path: "agent/manifest.json" },
  { label: "README", path: "agent/README.md" },
] as const;

/**
 * The agent a builder chat is making, beside the chat (the CRM's building
 * and review cards): its files as the builder writes them, then the saved
 * version to review and deploy from the agent's page.
 */
export function DraftPanel({ chat }: { chat: Chat }) {
  const { version, files, conversation } = chat;
  const agent = conversation.madeAgent;
  if (!version && files.length === 0) {
    return (
      <div className="space-y-2 p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No agent yet</p>
        <p>
          Switch on Create agent and describe the job. The builder writes the
          agent's instructions and manifest here, then saves a private draft for
          you to review. Nothing runs until you deploy it.
        </p>
      </div>
    );
  }
  const written = new Set(files.map((file) => file.path));
  return (
    <div className="space-y-5 p-5">
      {version?.manifest && agent ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
              {version.manifest.name}
            </h2>
            <Badge variant={STATUS_COPY[agent.status ?? "DRAFT"].tone}>
              {STATUS_COPY[agent.status ?? "DRAFT"].label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Version {version.number}
            {version.status === "READY" ? " · ready for review" : " · deployed"}
          </p>
          <ManifestReview manifest={version.manifest} />
          <Button
nativeButton={false}
            size="sm"
            className="w-full"
            render={
              <Link to="/agents/$agentId" params={{ agentId: agent.id }} />
            }
          >
            {agent.status === "DRAFT" ? "Review and deploy" : "Open agent"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Building the agent</h2>
          <ol className="space-y-1">
            {STEPS.map((step) => (
              <li key={step.path} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center",
                    written.has(step.path)
                      ? "text-success"
                      : "text-muted-foreground",
                  )}
                >
                  {written.has(step.path) ? (
                    <Check className="size-3.5" />
                  ) : (
                    "·"
                  )}
                </span>
                <span
                  className={
                    written.has(step.path) ? "" : "text-muted-foreground"
                  }
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {files.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Files</h2>
          <FileTabs files={files} />
        </section>
      ) : null}
    </div>
  );
}
