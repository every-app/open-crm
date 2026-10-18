import { useEffect, useState, type FormEvent } from "react";
import { cn } from "cn";
import { Markdown } from "@/client/components/Markdown";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import type { AgentQuestion, QuestionAnswer } from "@/shared/agent-question";

const FRAME = "space-y-3 rounded-lg border border-border bg-muted/40 p-3";

/** Each option's key, as the CRM's questionnaire lettered them. */
const LETTERS = "ABCDE";

/** Keys typed into a field are text, not shortcuts. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The agent's open question, answered where the composer was (the CRM's
 * AgentClarificationComposer): one of its options, chosen with a click or
 * its letter, or a typed answer where the question takes one. The answer
 * resumes its turn.
 */
export function QuestionComposer({
  question,
  pending,
  onAnswer,
}: {
  question: AgentQuestion;
  pending: boolean;
  onAnswer: (answer: QuestionAnswer) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const { options, allowFreeform } = question;
  const chosen = options.find((option) => option.id === choice);
  const typed = allowFreeform ? text.trim() : "";
  const answer: QuestionAnswer | null = typed
    ? { answer: typed }
    : chosen
      ? { optionId: chosen.id, answer: chosen.label }
      : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pending || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 || typing(event.target)) return;
      const option = options[LETTERS.indexOf(event.key.toUpperCase())];
      if (!option) return;
      event.preventDefault();
      setChoice(option.id);
      setText("");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [options, pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answer && !pending) onAnswer(answer);
  };

  return (
    <form className={FRAME} onSubmit={submit}>
      <Markdown className="text-sm font-medium [overflow-wrap:anywhere]">
        {question.prompt}
      </Markdown>
      {options.length > 0 ? (
        <RadioGroup
          value={choice}
          onValueChange={(value) => {
            setChoice(String(value));
            setText("");
          }}
          aria-label="Answers"
        >
          {options.map((option, index) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2 has-data-checked:border-primary"
            >
              <RadioGroupItem
                value={option.id}
                disabled={pending}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                <span
                  className={cn(
                    "font-medium",
                    option.style === "danger" && "text-destructive",
                  )}
                >
                  {option.label}
                </span>
                {option.description ? (
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <kbd
                aria-hidden
                className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-background font-mono text-[0.625rem] text-muted-foreground"
              >
                {LETTERS[index]}
              </kbd>
            </label>
          ))}
        </RadioGroup>
      ) : null}
      {allowFreeform ? (
        <Input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value) setChoice(null);
          }}
          placeholder={options.length > 0 ? "Another answer" : "Your answer"}
          aria-label={options.length > 0 ? "Another answer" : "Your answer"}
          disabled={pending}
        />
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" pending={pending} disabled={!answer}>
          Submit
        </Button>
      </div>
    </form>
  );
}
