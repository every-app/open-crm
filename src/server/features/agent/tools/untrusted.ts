// Text that neither the CRM nor anyone in the workspace wrote: captured mail
// and meetings, the pages the agent reads, and what a web search answers.
// Outsiders write it, so it reaches the model inside an envelope the
// instructions say never to take orders from (prompt/instructions.ts,
// skills/data-boundaries.md): a planted "ignore your instructions" reads as
// a quote.

type Source = "email" | "meeting" | "web page" | "web search";

const TAG = "untrusted-data";

/** `text` in its envelope. Nothing inside can name the tag, so it can't close it. */
export function untrusted(text: string, source: Source): string {
  const inner = text.replace(/untrusted-data/gi, "untrusted data");
  return `<${TAG} source="${source}">\n${inner}\n</${TAG}>`;
}

type Thread = { subject: string | null; messages: { body: string | null }[] };
type Meeting = { title: string | null };

/** A history read with its captured mail and meetings in their envelope. */
export function labelCaptured<
  T extends { threads: Thread[]; meetings: Meeting[] },
>(history: T): T {
  return {
    ...history,
    threads: history.threads.map((thread) => ({
      ...thread,
      subject: thread.subject && untrusted(thread.subject, "email"),
      messages: thread.messages.map((message) => ({
        ...message,
        body: message.body && untrusted(message.body, "email"),
      })),
    })),
    meetings: history.meetings.map((meeting) => ({
      ...meeting,
      title: meeting.title && untrusted(meeting.title, "meeting"),
    })),
  };
}
