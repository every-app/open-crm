import type { ClientToolSchema } from "@cloudflare/think/react";
import { ASK_QUESTION, QUESTION_PARAMETERS } from "@/shared/agent-question";

// A record chat's open questions (src/shared/agent-question.ts). Think takes
// tools a chat client offers (Think's client tools): this one has no server
// side, so when the model calls it the turn parks on the question, the Agent
// tab asks it in place of the composer, and the answer goes back as the
// tool's output (`addToolOutput`), which resumes the turn. Only a person's
// chat offers it: a research session has nobody to ask.

export const askQuestionTool: ClientToolSchema = {
  name: ASK_QUESTION,
  description:
    "Ask the rep one focused question when a decision only they can make blocks the answer, and wait for their reply. The case it exists for: two or more people match this record and the evidence cannot tell them apart. Offer each candidate as an option, with the id of the record it stands for and what tells it apart (title, employer, profile); allow a typed answer when one of their own (none of these, someone else) is valid. Never ask for something the CRM or another tool can tell you, never for an id, and never for optional detail. The rep answers in place, and their answer comes back as this tool's output.",
  parameters: QUESTION_PARAMETERS,
};
