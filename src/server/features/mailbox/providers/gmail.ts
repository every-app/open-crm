import { z } from "zod";
import {
  decodeBase64Url,
  normaliseMessageId,
  rootMessageIdFrom,
  stripHtml,
  stripQuotedHistory,
} from "@/server/features/mailbox/lib/messageText";
import {
  parseAddress,
  parseAddressList,
} from "@/server/features/mailbox/lib/participants";
import { CaptureWriteRepository } from "@/server/features/mailbox/repositories/CaptureWriteRepository";
import {
  CaptureService,
  type IncomingMessage,
} from "@/server/features/mailbox/services/CaptureService";
import { budgetLeft, mailboxGet } from "./mailboxApi";
import { failureOf, type SyncJob, type SyncResult } from "./syncJob";

// Gmail, read-only and forward-only, ported from the CRM's gmail.client.ts,
// gmail-mime.ts and gmail-sync.service.ts. The first check records the
// mailbox's historyId and imports nothing; each later one reads the history
// since its cursor and files up to 120 new messages. A history Gmail no
// longer keeps resets the cursor to now.

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const MAX_MESSAGES_PER_CHECK = 120;

const profileSchema = z.object({
  emailAddress: z.string().optional(),
  historyId: z.string().optional(),
});

const historySchema = z.object({
  history: z
    .array(
      z.object({
        id: z.string().optional(),
        messagesAdded: z
          .array(
            z.object({
              message: z.object({ id: z.string().optional() }).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string().optional(),
});

const headerSchema = z.object({
  name: z.string().optional(),
  value: z.string().optional(),
});

type GmailHeader = z.infer<typeof headerSchema>;

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPart[];
};

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

const messageSchema = z.object({
  id: z.string().optional(),
  internalDate: z.string().optional(),
  payload: partSchema.optional(),
});

type GmailMessage = z.infer<typeof messageSchema>;

/** The mailbox's address and its current historyId. */
export async function gmailProfile(
  accessToken: string,
  budget: SyncJob["budget"],
) {
  return mailboxGet(`${BASE}/profile`, accessToken, profileSchema, budget);
}

export async function syncGmail(job: SyncJob): Promise<SyncResult> {
  const { row, accessToken, budget } = job;
  if (!row.cursor) {
    const profile = await gmailProfile(accessToken, budget);
    if (profile.outcome !== "ok") return failureOf(profile);
    if (!profile.data.historyId) {
      return { status: "FAILED", reason: "Gmail returned no historyId." };
    }
    console.log("[mailbox] gmail watching for new mail", {
      organizationId: row.organizationId,
      userId: row.userId,
    });
    return { status: "IDLE", cursor: profile.data.historyId };
  }

  const start = row.cursor;
  const history = await mailboxGet(
    `${BASE}/history`,
    accessToken,
    historySchema,
    budget,
    {
      startHistoryId: start,
      historyTypes: "messageAdded",
      maxResults: 500,
    },
  );
  if (history.outcome === "cursor-invalid") {
    console.warn("[mailbox] gmail history expired: resuming from now", {
      organizationId: row.organizationId,
      userId: row.userId,
    });
    return { status: "IDLE", cursor: null };
  }
  if (history.outcome !== "ok") return failureOf(history);

  const entries = history.data.history ?? [];
  const ids = entries.flatMap((entry) =>
    (entry.messagesAdded ?? []).flatMap((added) =>
      added.message?.id ? [added.message.id] : [],
    ),
  );
  const stored = await CaptureWriteRepository.storedGmailIds(
    row.organizationId,
    ids,
  );

  // How far every message has been handled: a history record is passed only
  // once all of its messages are, so a check cut short resumes there.
  let cursor = start;
  let fetched = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const added of entry.messagesAdded ?? []) {
      const id = added.message?.id;
      if (!id || stored.has(id) || seen.has(id)) continue;
      if (fetched >= MAX_MESSAGES_PER_CHECK || !budgetLeft(budget)) {
        return { status: "IDLE", cursor };
      }
      seen.add(id);
      fetched += 1;
      const message = await mailboxGet(
        `${BASE}/messages/${encodeURIComponent(id)}`,
        accessToken,
        messageSchema,
        budget,
        { format: "full" },
      );
      // Deleted since it arrived: nothing to file.
      if (message.outcome === "cursor-invalid") continue;
      if (message.outcome !== "ok") return failureOf(message, cursor);
      const parsed = parseGmailMessage(message.data);
      if (parsed) {
        await CaptureService.storeMessage(
          job.capture,
          parsed,
          await job.context(),
        );
      }
    }
    if (entry.id) cursor = entry.id;
  }
  // A history longer than a page continues from its last record next time.
  return {
    status: "IDLE",
    cursor: history.data.nextPageToken
      ? cursor
      : (history.data.historyId ?? cursor),
  };
}

function header(
  headers: readonly GmailHeader[] | undefined,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  const found = headers?.find((entry) => entry.name?.toLowerCase() === wanted);
  return found?.value?.trim() ?? null;
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename) return true;
  const disposition = header(part.headers, "content-disposition");
  return disposition?.toLowerCase().startsWith("attachment") ?? false;
}

function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && !part.filename && part.body?.data) {
    return part;
  }
  for (const child of part.parts ?? []) {
    if (isAttachment(child)) continue;
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

/** The message's text: its text/plain part, else its HTML as text. */
function plainTextBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data));
  if (payload.body?.data && !payload.filename) {
    return decodeBase64Url(payload.body.data);
  }
  return "";
}

function sentAtOf(message: GmailMessage): string | null {
  if (message.internalDate) {
    const at = new Date(Number(message.internalDate));
    if (!Number.isNaN(at.getTime())) return at.toISOString();
  }
  const raw = header(message.payload?.headers, "date");
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** A Gmail message as the pipeline files it; null without the headers it needs. */
function parseGmailMessage(message: GmailMessage): IncomingMessage | null {
  const headers = message.payload?.headers;
  const rawMessageId = header(headers, "message-id");
  if (!rawMessageId) return null;
  const from = parseAddress(header(headers, "from") ?? "");
  if (!from) return null;
  const sentAt = sentAtOf(message);
  if (!sentAt) return null;

  const rootId =
    rootMessageIdFrom({
      references: header(headers, "references"),
      inReplyTo: header(headers, "in-reply-to"),
      messageId: rawMessageId,
    }) ?? normaliseMessageId(rawMessageId);
  const people = (name: string, kind: "to" | "cc") =>
    parseAddressList(header(headers, name)).map((person) => ({
      ...person,
      kind,
    }));

  return {
    rfcMessageId: normaliseMessageId(rawMessageId),
    rootId,
    subject: header(headers, "subject"),
    from,
    recipients: [...people("to", "to"), ...people("cc", "cc")],
    body: stripQuotedHistory(plainTextBody(message.payload)),
    sentAt,
    gmailMessageId: message.id ?? null,
  };
}
