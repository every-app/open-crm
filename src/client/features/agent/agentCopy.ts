import type { RecordKind } from "@/shared/records";

// What the Agent tab says before a conversation starts, by kind of record
// (the CRM's lib/agent-record.ts).

type RecordCopy = {
  title: string;
  placeholder: string;
  suggestions: string[];
};

export const RECORD_COPY: Record<RecordKind, RecordCopy> = {
  contact: {
    title: "Ask about this person",
    placeholder: "Are they still there?",
    suggestions: [
      "Who is this person?",
      "Are they still there?",
      "What should I know before a call?",
    ],
  },
  company: {
    title: "Ask about this company",
    placeholder: "What do they sell?",
    suggestions: [
      "What do they do?",
      "Who do we know here?",
      "What has changed recently?",
    ],
  },
  deal: {
    title: "Ask about this deal",
    placeholder: "Where has this stalled?",
    suggestions: [
      "Where does this stand?",
      "Who else should be involved?",
      "What is the risk here?",
    ],
  },
};
