import type { RecordKind } from "@/shared/records";

// What the Agent tab says before a conversation starts, by kind of record
// (the CRM's lib/agent-record.ts).

type RecordCopy = {
  title: string;
  blurb: string;
  placeholder: string;
  suggestions: string[];
};

export const RECORD_COPY: Record<RecordKind, RecordCopy> = {
  contact: {
    title: "Ask about this person",
    blurb:
      "Every step is shown as it happens — including the leads it throws away.",
    placeholder: "Are they still there?",
    suggestions: [
      "Who is this person?",
      "Are they still there?",
      "What should I know before a call?",
    ],
  },
  company: {
    title: "Ask about this company",
    blurb:
      "It reads their site and our own history with them, and shows its working.",
    placeholder: "What do they sell?",
    suggestions: [
      "What do they do?",
      "Who do we know here?",
      "What has changed recently?",
    ],
  },
  deal: {
    title: "Ask about this deal",
    blurb:
      "It can read the thread, the meetings and the people on both sides of it.",
    placeholder: "Where has this stalled?",
    suggestions: [
      "Where does this stand?",
      "Who else should be involved?",
      "What is the risk here?",
    ],
  },
};
