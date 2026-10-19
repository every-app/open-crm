import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { findLastIndex } from "remeda";
import { z } from "zod";
import {
  toolError,
  toolVerb,
  type Step,
  type Tone,
} from "@/client/features/agent/agentSteps";

// How a builder chat words its own steps, as the CRM's toolLabel
// (agent-tool-display.ts) did: the file it wrote, the draft it saved, the
// title it chose. A call can fail three ways: refused before it ran (its
// input didn't check: an `output-error` part with its errorText), thrown
// while it ran (the tool registry hands it back as `{ error }`, as it does a
// write the secret check refused or a save past the build's limits), or, for
// a draft, refused by the checks (`saved: false` with its issues). Any of
// them reads as failed, with its error, as the CRM's builder chat showed a
// step's errorText, and counts as neither written nor saved.

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

/** Each builder tool's step while it runs, once it did, and if it failed. */
const STEP_WORDS: Record<string, [string, string, string]> = {
  [WRITE_AGENT_FILE]: ["Writing", "Wrote", "Could not write"],
  save_agent_draft: ["Saving draft", "Saved draft", "Could not save draft"],
  set_chat_title: [
    "Naming this chat",
    "Named this chat",
    "Could not name this chat",
  ],
};

const namedInput = z
  .object({
    path: z.string().catch(""),
    name: z.string().catch(""),
    title: z.string().catch(""),
  })
  .partial()
  .catch({});

const unsavedDraft = z
  .object({ saved: z.literal(false), issues: z.array(z.string()) })
  .nullable()
  .catch(null);

/**
 * A builder tool's step in the CRM's words (its toolLabel), any other step
 * whose call was refused before it ran, with its error, or null.
 */
export function builderStep(part: Part, live: boolean): Step | null {
  if (!isToolUIPart(part)) return null;
  const tool = getToolName(part);
  const words = STEP_WORDS[tool];
  const refused = part.state === "output-error";
  if (!words && !refused) return null;
  const output = part.state === "output-available" ? part.output : null;
  const error = refused
    ? part.errorText.trim() || null
    : (toolError(output) ??
      unsavedDraft.parse(output)?.issues.join(" ") ??
      null);
  const withError = (label: string) => (error ? `${label} — ${error}` : label);
  if (!words) {
    return { label: withError(toolVerb(tool)), tone: "warning", sources: [] };
  }
  const done = part.state === "output-available" || refused;
  // A call still open in a reply that is no longer streaming never finished.
  const failed = error !== null || refused || (!done && !live);
  const tone: Tone = failed ? "warning" : done ? "success" : "neutral";
  const [doing, did, couldNot] = words;
  // A call refused before it ran keeps what it was asked as its raw input.
  const input = namedInput.parse(
    refused && part.input === undefined && "rawInput" in part
      ? part.rawInput
      : part.input,
  );
  const object =
    tool === WRITE_AGENT_FILE
      ? (FILE_NAMES[input.path ?? ""] ?? input.path)
      : tool === "save_agent_draft"
        ? input.name?.trim()
        : input.title?.trim();
  const verb = failed ? couldNot : done ? did : doing;
  const label = !object
    ? verb
    : tool === WRITE_AGENT_FILE
      ? `${verb} ${object}`
      : `${verb} · ${object}`;
  return { label: withError(label), tone, sources: [] };
}
