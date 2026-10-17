import type { ClientToolSchema } from "@cloudflare/think/react";
import {
  ASK_QUESTION,
  askQuestionTool,
} from "@/client/features/agent/askQuestion";

// The builder's clarifying questionnaire, the CRM's durable `ask_question`:
// the builder asks one focused question when an essential choice (a Slack
// channel, which teammate, a schedule) can't be derived, the chat asks it in
// place of the composer, and the answer resumes the build. Same tool and UI
// as a record chat's question, with the builder's own guidance.
export const builderAskQuestionTool: ClientToolSchema = {
  ...askQuestionTool,
  name: ASK_QUESTION,
  description:
    "Ask the person one focused question when an essential choice blocks a safe draft: which inspected Slack channel or teammate, which schedule, or which outcome. Offer two to four inspected options (an id-free label each, with what tells it apart). Never ask for an id, a handle that inspect_context already resolves, or optional polish. Their answer comes back as this tool's output.",
};
