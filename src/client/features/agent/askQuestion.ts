import type { ClientToolSchema } from "@cloudflare/think/react";
import { z } from "zod";

// The agent's open questions, the CRM's `ask_question` ("two Marchettis at
// Fernhill, which one?"). Think takes tools a chat client offers (Think's
// client tools): this one has no server side, so when the model calls it the
// turn parks on the question, the Agent tab asks it in place of the composer,
// and the answer goes back as the tool's output (`addToolOutput`), which
// resumes the turn. Only a person's chat offers it: a research session has
// nobody to ask.

export const ASK_QUESTION = "ask_question";

export const askQuestionTool: ClientToolSchema = {
  name: ASK_QUESTION,
  description:
    "Ask the rep one focused question when a decision only they can make blocks the answer, and wait for their reply. The case it exists for: two or more people match this record and the evidence cannot tell them apart. Offer each candidate as an option, with what tells it apart (title, employer, profile). Never ask for something the CRM or another tool can tell you, never for an id, and never for optional detail. The rep answers in place, and their answer comes back as this tool's output.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "The question, in a sentence or two, saying what you found that you cannot settle.",
      },
      options: {
        type: "array",
        maxItems: 5,
        description:
          "The answers to choose from, when there are candidates. The rep can always type an answer of their own instead.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "The candidate or answer." },
            description: {
              type: "string",
              description: "What tells this one apart.",
            },
          },
          required: ["label"],
        },
      },
    },
    required: ["prompt"],
  },
};

const NO_PROMPT = "The agent has a question.";

const questionSchema = z
  .object({
    prompt: z.string().trim().min(1).catch(NO_PROMPT),
    options: z
      .array(
        z.object({
          label: z.string().trim().min(1),
          description: z.string().trim().optional().catch(undefined),
        }),
      )
      .max(5)
      .catch([]),
  })
  .catch({ prompt: NO_PROMPT, options: [] });

export type AgentQuestion = z.infer<typeof questionSchema>;

/** The model's question, as far as it is usable. */
export function parseQuestion(input: unknown): AgentQuestion {
  return questionSchema.parse(input);
}

/** What the tool returns to the model once the rep has answered. */
export type QuestionAnswer = { answer: string };
