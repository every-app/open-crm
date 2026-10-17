import { useState, type FormEvent } from "react";
import { Markdown } from "@/client/components/Markdown";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import type { AgentQuestion } from "./askQuestion";

const FRAME = "space-y-3 rounded-lg border border-border bg-muted/40 p-3";

/**
 * The agent's open question, answered where the composer was (the CRM's
 * AgentClarificationComposer): pick one of its candidates, or say something
 * else. The answer resumes its turn.
 */
export function QuestionComposer({
  question,
  pending,
  onAnswer,
}: {
  question: AgentQuestion;
  pending: boolean;
  onAnswer: (answer: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const chosen = choice === null ? undefined : question.options[Number(choice)];
  const answer = text.trim() || chosen?.label || "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answer && !pending) onAnswer(answer);
  };

  return (
    <form className={FRAME} onSubmit={submit}>
      <div className="space-y-1">
        <Markdown className="text-sm font-medium [overflow-wrap:anywhere]">
          {question.prompt}
        </Markdown>
        <p className="text-xs text-muted-foreground">
          {question.options.length > 0
            ? "Choose an answer, then submit."
            : "Add the detail the agent needs to continue."}
        </p>
      </div>
      {question.options.length > 0 ? (
        <RadioGroup
          value={choice}
          onValueChange={(value) => {
            setChoice(String(value));
            setText("");
          }}
          aria-label="Answers"
        >
          {question.options.map((option, index) => (
            <label
              key={`${index}-${option.label}`}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2 has-data-checked:border-primary"
            >
              <RadioGroupItem
                value={String(index)}
                disabled={pending}
                className="mt-0.5"
              />
              <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </RadioGroup>
      ) : null}
      <Input
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (event.target.value) setChoice(null);
        }}
        placeholder="Add the detail the agent needs"
        aria-label={
          question.options.length > 0 ? "Another answer" : "Your answer"
        }
        disabled={pending}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" pending={pending} disabled={!answer}>
          Submit answer
        </Button>
      </div>
    </form>
  );
}
