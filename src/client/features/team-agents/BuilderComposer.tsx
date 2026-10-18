import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, Bot, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/client/components/ui/input-group";
import { Toggle } from "@/client/components/ui/toggle";
import { uploadBuilderAttachment } from "@/serverFunctions/teamAgents";
import {
  builderCommandType,
  consumeBuilderCommand,
} from "@/shared/builder-command";
import { PREVIEWABLE_IMAGE_TYPES } from "@/shared/team-agents";
import { TagPicker, tagText, type TaggedResource } from "./TagPicker";
import { CREATE_AGENT_PREFIX } from "./teamAgentCopy";

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
};

/** What the composer sends: the files are uploaded with the message. */
export type ComposerMessage = {
  text: string;
  resources: TaggedResource[];
  files: File[];
};

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 2_000_000;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

/** A file as the server takes it: its name, type and base64 bytes. */
export async function attachmentContent(file: File) {
  return {
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    contentBase64: await toBase64(file),
  };
}

/** Keeps the files a message attaches in its chat, for the message to name. */
export async function uploadAttachments(
  conversationId: string,
  files: readonly File[],
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  for (const file of files) {
    attachments.push(
      await uploadBuilderAttachment({
        data: { conversationId, ...(await attachmentContent(file)) },
      }),
    );
  }
  return attachments;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The files among `list` a message can carry, saying why of any it can't. */
function acceptedFiles(list: FileList | null, room: number): File[] {
  const accepted: File[] = [];
  for (const file of Array.from(list ?? []).slice(0, room)) {
    if (file.size === 0) toast.error(`${file.name} is empty.`);
    else if (file.size > MAX_BYTES)
      toast.error(`${file.name} is larger than 2 MB.`);
    else if (file.name.length > 180) toast.error("That file name is too long.");
    else if (file.type.length > 120)
      toast.error(`${file.name} has an unsupported file type.`);
    else accepted.push(file);
  }
  return accepted;
}

/**
 * The builder chat's composer (the CRM's AgentComposer): tag records and
 * integrations, attach files, and switch "Create agent" on to ask the builder
 * for an agent rather than an answer. Asking for one in words ("set up an
 * agent that…") switches it on too. Enter sends, Shift+Enter breaks the line.
 */
export function BuilderComposer({
  mode,
  busy,
  initialText = "",
  initialCreating = false,
  onSend,
  onStop,
}: {
  /** The builder home, or a chat. */
  mode: "home" | "chat";
  busy: boolean;
  initialText?: string;
  initialCreating?: boolean;
  /** Settles once the message is sent; a failure keeps it to send again. */
  onSend: (message: ComposerMessage) => Promise<unknown>;
  onStop?: () => void;
}) {
  const [value, setValue] = useState(initialText);
  const [creating, setCreating] = useState(initialCreating);
  const [tags, setTags] = useState<TaggedResource[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = busy || sending;

  function change(text: string) {
    // "/Create agent" typed out (and a space after it) is the switch; asking
    // in words turns it on.
    const command = consumeBuilderCommand(text);
    if (command !== null && (command || /\s$/.test(text))) {
      setCreating(true);
      setValue(command);
      return;
    }
    if (builderCommandType(text) === "CREATE_AGENT") setCreating(true);
    setValue(text);
  }

  async function submit() {
    const text = value.trim();
    if (!text || locked) return;
    // A request in words is one as it stands; otherwise the switch says so.
    const asks = builderCommandType(text) === "CREATE_AGENT";
    setSending(true);
    try {
      await onSend({
        text: creating && !asks ? `${CREATE_AGENT_PREFIX}${text}` : text,
        resources: tags,
        files,
      });
      setValue("");
      setTags([]);
      setFiles([]);
      setCreating(false);
    } catch {
      // The sender said what went wrong; the message stays to send again.
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {tags.length > 0 || files.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip
              key={`${tag.kind}:${tag.id}`}
              label={tagText(tag.label)}
              onRemove={() =>
                setTags((current) => current.filter((entry) => entry !== tag))
              }
            />
          ))}
          {files.map((file, index) => (
            <Chip
              key={`${file.name}:${index}`}
              label={`${file.name} · ${formatBytes(file.size)}`}
              thumbnail={<FileThumbnail file={file} />}
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
          onChange={(event) => change(event.target.value)}
          onKeyDown={handleKey}
          rows={2}
          placeholder={
            mode === "home"
              ? "Ask about your CRM or automate a task…"
              : "Send a message"
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
            <InputGroupButton
              size="icon-sm"
              aria-label="Attach files"
              disabled={locked || files.length >= MAX_ATTACHMENTS}
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
                const accepted = acceptedFiles(
                  event.target.files,
                  MAX_ATTACHMENTS - files.length,
                );
                setFiles((current) => [...current, ...accepted]);
                event.target.value = "";
              }}
            />
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
              disabled={locked || !value.trim()}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** An image file's thumbnail, as the CRM's attachment chips showed one. */
function FileThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!PREVIEWABLE_IMAGE_TYPES.has(file.type.toLowerCase())) return undefined;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img src={url} alt="" className="size-4 shrink-0 rounded-sm object-cover" />
  ) : null;
}

function Chip({
  label,
  thumbnail,
  onRemove,
}: {
  label: string;
  thumbnail?: ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 max-w-60 items-center gap-1 rounded-md border border-border bg-muted/50 pr-1 pl-2 text-xs has-[img]:pl-1">
      {thumbnail}
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
