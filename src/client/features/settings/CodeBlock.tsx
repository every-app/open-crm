import { CopyButton } from "@/client/components/CopyButton";

/** Text to paste somewhere else (a tag, a command), with its Copy button. */
export function CodeBlock({
  value,
  successMessage = "Copied.",
}: {
  value: string;
  successMessage?: string;
}) {
  return (
    <div className="flex w-full min-w-0 items-start gap-2">
      <pre className="min-w-0 flex-1 rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap">
        {value}
      </pre>
      <CopyButton
        value={value}
        successMessage={successMessage}
        className="mt-1"
      />
    </div>
  );
}
