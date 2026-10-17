import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, AtSign, Bot, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/client/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Toggle } from "@/client/components/ui/toggle";
import { uploadBuilderAttachment } from "@/serverFunctions/teamAgents";
import { builderResourcesQueryOptions } from "./teamAgentQueries";
import { CREATE_AGENT_PREFIX } from "./teamAgentCopy";

export type TaggedResource = {
  kind: "company" | "contact" | "deal" | "integration";
  id: string;
  label: string;
};

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
};

/** What one message carries: its text, and the tags and files riding on it. */
export type BuilderMessage = {
  text: string;
  metadata: { resources: TaggedResource[]; attachments: Attachment[] };
};

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 2_000_000;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The builder chat's composer (the CRM's AgentComposer): tag records and
 * integrations, attach files, and switch "Create agent" on to ask the builder
 * for an agent rather than an answer. Enter sends, Shift+Enter breaks the
 * line.
 */
export function BuilderComposer({
  conversationId,
  busy,
  initialText = "",
  initialCreating = false,
  onSend,
  onStop,
}: {
  /** Attachments need the chat; the builder home has none yet. */
  conversationId: string | null;
  busy: boolean;
  initialText?: string;
  initialCreating?: boolean;
  onSend: (message: BuilderMessage) => void;
  onStop?: () => void;
}) {
  const [value, setValue] = useState(initialText);
  const [creating, setCreating] = useState(initialCreating);
  const [tags, setTags] = useState<TaggedResource[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!conversationId) throw new Error("No chat yet");
      return uploadBuilderAttachment({
        data: {
          conversationId,
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          contentBase64: await toBase64(file),
        },
      });
    },
    onSuccess: (attachment) => setFiles((current) => [...current, attachment]),
  });

  function submit() {
    const text = value.trim();
    if (!text || busy || upload.isPending) return;
    onSend({
      text: creating ? `${CREATE_AGENT_PREFIX}${text}` : text,
      metadata: { resources: tags, attachments: files },
    });
    setValue("");
    setTags([]);
    setFiles([]);
    setCreating(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function pickFiles(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      if (files.length >= MAX_ATTACHMENTS) {
        toast.error(`Up to ${MAX_ATTACHMENTS} files per message.`);
        break;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 2 MB.`);
        continue;
      }
      upload.mutate(file);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {tags.length > 0 || files.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip
              key={`${tag.kind}:${tag.id}`}
              label={`@${tag.label}`}
              onRemove={() =>
                setTags((current) => current.filter((entry) => entry !== tag))
              }
            />
          ))}
          {files.map((file) => (
            <Chip
              key={file.id}
              label={file.name}
              onRemove={() =>
                setFiles((current) => current.filter((entry) => entry !== file))
              }
            />
          ))}
        </div>
      ) : null}
      <InputGroup className="items-end rounded-xl bg-card has-disabled:bg-card has-disabled:opacity-100 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKey}
          rows={2}
          placeholder={
            creating
              ? "Describe the agent: when it runs, what it looks at, what it does"
              : "Ask about your CRM, or switch on Create agent"
          }
          aria-label="Message the agent builder"
          className="max-h-48 min-h-0 px-3 leading-relaxed"
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <div className="flex items-center gap-1">
            <Toggle
              size="sm"
              variant="outline"
              pressed={creating}
              onPressedChange={setCreating}
              aria-label="Create agent"
            >
              <Bot />
              Create agent
            </Toggle>
            <TagPicker
              onPick={(tag) =>
                setTags((current) =>
                  current.some(
                    (entry) => entry.kind === tag.kind && entry.id === tag.id,
                  )
                    ? current
                    : [...current, tag],
                )
              }
            />
            {conversationId ? (
              <>
                <InputGroupButton
                  size="icon-sm"
                  aria-label="Attach a file"
                  disabled={upload.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip />
                </InputGroupButton>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    pickFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
          </div>
          {busy && onStop ? (
            <InputGroupButton
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label="Stop"
              onClick={onStop}
            >
              <Square className="size-3.5 fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="rounded-full"
              aria-label="Send message"
              disabled={busy || upload.isPending || !value.trim()}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 max-w-60 items-center gap-1 rounded-md border border-border bg-muted/50 pr-1 pl-2 text-xs">
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="text-muted-foreground hover:text-foreground"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Search the CRM's records (and Slack, when connected) to tag one. */
function TagPicker({ onPick }: { onPick: (tag: TaggedResource) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useQuery({
    ...builderResourcesQueryOptions(query),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            size="icon-sm"
            aria-label="Tag a record or integration"
          />
        }
      >
        <AtSign />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records and integrations"
            aria-label="Search records and integrations"
          />
        </div>
        <div className="flex max-h-64 flex-col overflow-y-auto py-1">
          {(results.data ?? []).map((resource) => (
            <Button
              key={`${resource.kind}:${resource.id}`}
              variant="ghost"
              className="h-auto flex-col items-start rounded-none px-3 py-2 text-left font-normal"
              onClick={() => {
                onPick({
                  kind: resource.kind,
                  id: resource.id,
                  label: resource.label,
                });
                setOpen(false);
                setQuery("");
              }}
            >
              <span className="text-sm">{resource.label}</span>
              <span className="text-xs text-muted-foreground">
                {resource.kind === "integration"
                  ? resource.detail
                  : [resource.kind, resource.detail]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </Button>
          ))}
          {results.data?.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {query.trim().length < 2
                ? "Type two letters to search."
                : "Nothing matches."}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
