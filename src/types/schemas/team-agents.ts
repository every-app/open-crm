import { z } from "zod";
import { CAPTURE_KINDS, FEEDBACK_RATINGS } from "@/shared/team-agents";

const id = z.string().trim().min(1).max(128);
const requestId = z.uuid();

/**
 * The longest name and description a person gives an agent, as the CRM's
 * agents.update and New agent took them (its builder's drafts stay shorter).
 */
export const AGENT_NAME_MAX = 120;
export const AGENT_DESCRIPTION_MAX = 500;

export const agentIdSchema = z.object({ agentId: id });

export const agentVersionSchema = z.object({ agentId: id, versionId: id });

export const agentHistorySchema = z.object({
  agentId: id,
  limit: z.number().int().min(1).max(100).default(50),
});

export const deployAgentSchema = z.object({
  agentId: id,
  versionId: id,
  clientRequestId: requestId,
});

export const agentTransitionSchema = z.object({
  agentId: id,
  action: z.enum(["pause", "resume", "archive", "restore"]),
});

export const runAgentSchema = z.object({
  agentId: id,
  clientRequestId: requestId,
});

export const retryRunSchema = z.object({
  agentId: id,
  runId: id,
  clientRequestId: requestId,
});

export const cancelRunSchema = z.object({ agentId: id, runId: id });

export const reviseAgentSchema = z.object({
  agentId: id,
  clientRequestId: requestId,
  actions: z.array(z.string().min(1).max(120)).max(10).optional(),
  channel: z
    .object({ id: id, name: z.string().trim().min(1).max(120) })
    .optional(),
  resources: z
    .array(
      z.object({
        kind: z.enum(["company", "contact", "deal"]),
        id,
        label: z.string().trim().min(1).max(160),
      }),
    )
    .max(30)
    .optional(),
  sources: z.array(z.enum(CAPTURE_KINDS)).max(2).optional(),
});

export const saveFilesSchema = z.object({
  agentId: id,
  clientRequestId: requestId,
  files: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(200),
        content: z.string().max(40_000),
      }),
    )
    .min(1)
    .max(10),
});

export const builderChatIdSchema = z.object({ conversationId: id });

export const builderResourcesSchema = z.object({
  q: z.string().max(120).default(""),
});

export const rateBuilderReplySchema = z.object({
  conversationId: id,
  messageId: z.string().trim().min(1).max(200),
  rating: z.enum(FEEDBACK_RATINGS).nullable(),
});

/** A file to keep in a chat: at most 2 MB of bytes (base64 grows it by ⅓). */
const attachmentContent = z.object({
  name: z.string().trim().min(1).max(180),
  mediaType: z.string().trim().min(1).max(120),
  contentBase64: z
    .string()
    .min(1)
    .max(2_800_000)
    .regex(/^[A-Za-z\d+/]*={0,2}$/, "Attachment content must be base64."),
});

/** One attachment per call. */
export const uploadAttachmentSchema = attachmentContent.extend({
  conversationId: id,
});

const storedImage = z.string().startsWith("/api/images/").max(500).nullable();

/**
 * A tag's picture: our copies of its logo or photo (src/server/lib/images.ts),
 * never a vendor's URL.
 */
export const tagPictureSchema = z.object({
  url: storedImage,
  darkUrl: storedImage,
  tone: z.string().max(20).nullable(),
});

/**
 * A chat started from Chat home, with its first message and the records and
 * files that message carries. The client picks the chat's id, once per
 * message, so that a retry finds the chat its first try started.
 */
export const startBuilderChatSchema = z.object({
  chatId: requestId,
  text: z.string().trim().min(1).max(20_000),
  resources: z
    .array(
      z.object({
        kind: z.enum(["company", "contact", "deal", "integration"]),
        id,
        label: z.string().trim().min(1).max(160),
        picture: tagPictureSchema.optional(),
      }),
    )
    .max(20),
  attachments: z.array(attachmentContent).max(5),
});
