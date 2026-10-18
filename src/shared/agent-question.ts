import type { JSONSchema7 } from "ai";
import { z } from "zod";

// The agent's clarifying question, the CRM's `ask_question` ("two Marchettis
// at Fernhill, which one?"), as both chats ask it: a prompt, how it is
// answered (a confirmation, a choice among options, or typed text), options
// each with an id and a style, and whether a typed answer is taken besides.
// The person's answer goes back as the tool's output, and the server takes
// only an answer the question offers, once (conversations.contracts.ts and
// conversations.service.ts in the CRM).

export const ASK_QUESTION = "ask_question";

const DISPLAYS = ["confirmation", "select", "text"] as const;
const STYLES = ["primary", "default", "danger"] as const;

/** The tool's parameters, for the model. */
export const QUESTION_PARAMETERS: JSONSchema7 = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description:
        "The question, in a sentence or two, saying what you found that you cannot settle.",
    },
    display: {
      type: "string",
      enum: [...DISPLAYS],
      description:
        "How it is answered: confirmation for a yes or no, select to choose among the options, text for a typed answer.",
    },
    options: {
      type: "array",
      maxItems: 5,
      description: "The answers to choose from, when there are candidates.",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "The answer's id, which comes back with it: the inspected id it stands for, when it has one.",
          },
          label: { type: "string", description: "The candidate or answer." },
          description: {
            type: "string",
            description: "What tells this one apart.",
          },
          style: {
            type: "string",
            enum: [...STYLES],
            description:
              "primary for the answer you recommend, danger for one that removes or overwrites something.",
          },
        },
        required: ["id", "label"],
      },
    },
    allowFreeform: {
      type: "boolean",
      description:
        "Whether the person may type an answer of their own instead of choosing one.",
    },
  },
  required: ["prompt"],
};

const NO_PROMPT = "The agent has a question.";

const askedOption = z.object({
  id: z.string().trim().min(1).optional().catch(undefined),
  label: z.string().trim().min(1),
  description: z.string().trim().optional().catch(undefined),
  style: z.enum(STYLES).optional().catch(undefined),
});

const askedQuestion = z
  .object({
    prompt: z.string().trim().min(1).catch(NO_PROMPT),
    display: z.enum(DISPLAYS).optional().catch(undefined),
    options: z.array(askedOption.nullable().catch(null)).catch([]),
    allowFreeform: z.boolean().optional().catch(undefined),
  })
  .catch({ prompt: NO_PROMPT, options: [] })
  .transform((question) => {
    // An option asked without an id (before options had them) is known by
    // its place.
    const options = question.options
      .flatMap((option, index) =>
        option ? [{ ...option, id: option.id ?? String(index + 1) }] : [],
      )
      .slice(0, 5);
    return {
      prompt: question.prompt,
      display: question.display,
      options,
      // As the CRM read it: a text question, or one with nothing to choose
      // from, takes a typed answer.
      allowFreeform:
        question.allowFreeform === true ||
        question.display === "text" ||
        options.length === 0,
    };
  });

export type AgentQuestion = z.infer<typeof askedQuestion>;

/** The model's question, as far as it is usable. */
export function parseQuestion(input: unknown): AgentQuestion {
  return askedQuestion.parse(input);
}

/**
 * What the tool returns to the model once the person has answered: the
 * option they chose, by its id and label, or what they typed.
 */
export type QuestionAnswer = { answer: string; optionId?: string };

const sentAnswer = z.object({
  optionId: z.string().min(1).max(200).optional(),
  answer: z.string().max(4000).optional(),
});

/**
 * `output` as an answer to `question`, as the CRM's server took one: an
 * option the question offers (named by its label), or typed text where the
 * question takes it. Null for anything else.
 */
export function checkAnswer(
  question: AgentQuestion,
  output: unknown,
): QuestionAnswer | null {
  const sent = sentAnswer.safeParse(output);
  if (!sent.success) return null;
  const { optionId, answer } = sent.data;
  if (optionId !== undefined) {
    const option = question.options.find((entry) => entry.id === optionId);
    return option ? { optionId: option.id, answer: option.label } : null;
  }
  const text = answer?.trim() ?? "";
  return question.allowFreeform && text ? { answer: text } : null;
}
