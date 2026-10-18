import { useId, useState } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/client/components/ui/dialog";
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/client/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { slackChannelsQueryOptions } from "@/client/features/slack/slackQueries";
import { SLACK_RESOURCE, slackChannelResourceId } from "@/shared/team-agents";
import type { TaggedResource } from "./TagPicker";
import { CREATE_AGENT_PREFIX } from "./teamAgentCopy";
import { useStartChat } from "./useStartChat";

// Slack's "New agent" (the CRM's new-agent-dialog.tsx and agent-handoff.ts):
// a name, the job, the channel it lives in and what it may do there, handed
// to the builder as a new chat's first message with Slack and the channel
// tagged.

const PERMISSIONS = [
  { id: "post", label: "Post a message" },
  { id: "mention", label: "Mention the deal owner" },
  { id: "thread", label: "Reply in a thread" },
  { id: "history", label: "Read the channel history" },
] as const;

type Permission = (typeof PERMISSIONS)[number]["id"];

const briefSchema = z.object({
  name: z.string().trim().min(1, "Give the agent a name.").max(120),
  job: z.string().trim().min(1, "Say what the agent should do.").max(20_000),
  channelId: z.string(),
  allowed: z.array(z.enum(["post", "mention", "thread", "history"])),
});

type Channel = { id: string; name: string };

type Handoff = {
  name: string;
  job: string;
  channel: Channel | null;
  allowed: Permission[];
};

/** The builder's brief, as the CRM's handoffBrief wrote it. */
function handoffBrief(handoff: Handoff): string {
  const lines = [`Build an agent named "${handoff.name}".`, handoff.job];
  if (handoff.channel) {
    lines.push(
      `It posts to the tagged Slack channel #${handoff.channel.name} and nowhere else. Do not ask me where to post.`,
    );
  }
  lines.push(
    [
      "These Slack permissions are already decided. Use exactly this list and do not ask about it:",
      ...PERMISSIONS.map(
        (entry) =>
          `- ${entry.label}: ${handoff.allowed.includes(entry.id) ? "allowed" : "not allowed"}`,
      ),
    ].join("\n"),
  );
  return lines.join("\n\n");
}

/** Slack, and the channel it lives in, tagged on the brief. */
function handoffResources(channel: Channel | null): TaggedResource[] {
  return [
    SLACK_RESOURCE,
    ...(channel
      ? [
          {
            kind: "integration" as const,
            id: slackChannelResourceId(channel.id),
            label: `#${channel.name}`,
          },
        ]
      : []),
  ];
}

export function NewAgentDialog() {
  const [open, setOpen] = useState(false);
  const channelId = useId();
  const channels = useQuery({
    ...slackChannelsQueryOptions(""),
    enabled: open,
  });
  const rows = channels.data?.rows ?? [];
  const start = useStartChat();

  const form = useAppForm({
    defaultValues: {
      name: "",
      job: "",
      channelId: "",
      allowed: ["post", "mention"] as Permission[],
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: briefSchema },
    onSubmit: async ({ value }) => {
      const row = rows.find((entry) => entry.id === value.channelId);
      const channel = row ? { id: row.id, name: row.name } : null;
      await start.mutateAsync({
        text: `${CREATE_AGENT_PREFIX}${handoffBrief({
          name: value.name.trim(),
          job: value.job.trim(),
          channel,
          allowed: value.allowed,
        })}`,
        resources: handoffResources(channel),
        files: [],
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New agent</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
        </DialogHeader>
        <form.AppForm>
          <form.Form className="flex flex-col gap-4">
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Name"
                  autoComplete="off"
                  maxLength={120}
                />
              )}
            </form.AppField>
            <form.AppField name="job">
              {(field) => (
                <field.TextareaField label="What it should do" rows={3} />
              )}
            </form.AppField>
            <form.AppField name="channelId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={channelId}>Lives in</FieldLabel>
                  <Select
                    items={rows.map((row) => ({
                      value: row.id,
                      label: `#${row.name}`,
                    }))}
                    value={field.state.value || null}
                    onValueChange={(next) => {
                      if (typeof next === "string") field.handleChange(next);
                    }}
                  >
                    <SelectTrigger id={channelId} className="w-full">
                      <SelectValue placeholder="Pick a Slack channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {rows.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          #{row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.AppField>
            <form.AppField name="allowed">
              {(field) => (
                <FieldSet className="gap-0">
                  <FieldLegend variant="label">Allowed to</FieldLegend>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSIONS.map((entry) => {
                      const on = field.state.value.includes(entry.id);
                      return (
                        <Button
                          key={entry.id}
                          type="button"
                          variant={on ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={on}
                          onClick={() =>
                            field.handleChange(
                              on
                                ? field.state.value.filter(
                                    (id) => id !== entry.id,
                                  )
                                : [...field.state.value, entry.id],
                            )
                          }
                        >
                          {on ? <Check className="text-primary" /> : null}
                          {entry.label}
                        </Button>
                      );
                    })}
                  </div>
                </FieldSet>
              )}
            </form.AppField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <form.SubmitButton>Create</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
