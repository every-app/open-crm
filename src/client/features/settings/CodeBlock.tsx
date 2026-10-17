import { cn } from "cn";
import { CopyButton } from "@/client/components/CopyButton";

/** Text to paste somewhere else (a tag, a command), with its Copy button. */
export function CodeBlock({
  value,
  successMessage = "Copied",
  wrap = true,
}: {
  value: string;
  successMessage?: string;
  /** Wrap long lines; off for multi-line commands that scroll instead. */
  wrap?: boolean;
}) {
  return (
    <div className="flex w-full min-w-0 items-start gap-2">
      <pre
        className={cn(
          "min-w-0 flex-1 rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-xs leading-5",
          wrap ? "whitespace-pre-wrap wrap-anywhere" : "overflow-x-auto",
        )}
      >
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
