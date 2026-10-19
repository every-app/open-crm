import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { findLastIndex } from "remeda";
import { z } from "zod";
import {
  toolError,
  type Step,
  type Tone,
} from "@/client/features/agent/agentSteps";

// How a builder chat words its own steps, as the CRM's toolLabel
// (agent-tool-display.ts) did: the file it wrote, the draft it saved, the
// title it chose. A call that threw comes back as `{ error }` (the tool
// registry hands failures to the model), as one the secret check refused or
// one past the build's limits does: it reads as failed, with its error, as the
// record chat's steps do, and counts as neither written nor saved.

type Part = UIMessage["parts"][number];

const WRITE_AGENT_FILE = "write_agent_file";

const fileInput = z.object({ path: z.string().catch("") }).catch({ path: "" });

/**
 * The files the latest build has written, and the one it is writing, read
 * from its `write_agent_file` calls since the person's last message.
 */
export function buildProgress(messages: readonly UIMessage[]) {
  const lastUser = findLastIndex(
    messages,
    (message) => message.role === "user",
  );
  const written = new Set<string>();
  let writing: string | null = null;
  for (const message of messages.slice(lastUser + 1)) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolName(part) !== WRITE_AGENT_FILE) {
        continue;
      }
      const { path } = fileInput.parse(part.input);
      if (!path) continue;
      if (part.state === "output-available") {
        if (!toolError(part.output)) written.add(path);
      } else if (part.state !== "output-error") writing = path;
    }
  }
  return { written, writing };
}

const FILE_NAMES: Record<string, string> = {
  "agent/instructions.md": "instructions",
  "agent/manifest.json": "the manifest",
  "agent/README.md": "the readme",
};

const namedInput = z
  .object({
    name: z.string().catch(""),
    title: z.string().catch(""),
  })
  .partial()
  .catch({});

const unsavedDraft = z
  .object({ saved: z.literal(false), issues: z.array(z.string()) })
  .nullable()
  .catch(null);

/** A builder tool's step in the CRM's words (its toolLabel), or null. */
export function builderStep(part: Part, live: boolean): Step | null {
  if (!isToolUIPart(part)) return null;
  const tool = getToolName(part);
  const output = part.state === "output-available" ? part.output : null;
  const error = toolError(output);
  const done =
    part.state === "output-available" || part.state === "output-error";
  const failed =
    error !== null || part.state === "output-error" || (!done && !live);
  const finished = done && !failed;
  const tone: Tone = failed ? "warning" : done ? "success" : "neutral";
  const withError = (label: string) => (error ? `${label} — ${error}` : label);
  const input = namedInput.parse(part.input);
  if (tool === WRITE_AGENT_FILE) {
    const { path } = fileInput.parse(part.input);
    const name = FILE_NAMES[path] ?? path;
    return {
      label: withError(finished ? `Wrote ${name}` : `Writing ${name}`),
      tone,
      sources: [],
    };
  }
  if (tool === "save_agent_draft") {
    // A draft the checks refused was not saved: it says why.
    const unsaved = unsavedDraft.parse(output);
    const verb = finished && !unsaved ? "Saved draft" : "Saving draft";
    const name = input.name?.trim();
    const label = name ? `${verb} · ${name}` : verb;
    return unsaved
      ? {
          label: `${label} — ${unsaved.issues.join(" ")}`,
          tone: "warning",
          sources: [],
        }
      : { label: withError(label), tone, sources: [] };
  }
  if (tool === "set_chat_title") {
    const verb = finished ? "Named this chat" : "Naming this chat";
    const title = input.title?.trim();
    return {
      label: withError(title ? `${verb} · ${title}` : verb),
      tone,
      sources: [],
    };
  }
  return null;
}
