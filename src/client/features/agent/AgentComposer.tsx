import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/client/components/ui/input-group";

/**
 * Where a person writes to the agent (OpenSEO SAM's ChatComposer). Enter
 * sends, Shift+Enter breaks the line; while a reply streams, Send is Stop.
 */
export function AgentComposer({
  placeholder,
  busy,
  onSend,
  onStop,
}: {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
  /** Cancels the running turn. Without it, a busy composer only waits. */
  onStop?: () => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
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

  return (
    <form onSubmit={handleSubmit}>
      {/* InputGroup dims itself when it holds a disabled control. The empty
          composer disables only Send, so keep the field at full strength. */}
      <InputGroup className="items-end rounded-xl bg-card has-disabled:bg-card has-disabled:opacity-100 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder={placeholder}
          aria-label="Message the agent"
          className="max-h-40 min-h-0 px-3 leading-relaxed"
        />
        <InputGroupAddon align="inline-end">
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
              disabled={busy || !value.trim()}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
