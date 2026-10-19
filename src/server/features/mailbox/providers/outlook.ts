import { z } from "zod";
import {
  messageBody,
  normaliseMessageId,
  rootMessageIdFrom,
  stripHtml,
} from "@/server/features/mailbox/lib/messageText";
import { parseAddress, type Participant } from "@/shared/participants";
import {
  CaptureService,
  type IncomingMessage,
} from "@/server/features/mailbox/services/CaptureService";
import { budgetLeft, mailboxGet, type MailboxResult } from "./mailboxApi";
import { failureOf, type SyncJob, type SyncResult } from "./syncJob";

// Outlook through Microsoft Graph, read-only and forward-only, ported from
// the CRM's graph.client.ts and outlook-sync.service.ts. Graph has no
// mailbox-wide delta, so the cursor is the last receivedDateTime seen, read
// again with a one-second overlap (a message's RFC id is unique, so the
// overlap costs a fetch, never a duplicate). Junk and deleted items are
// skipped. A thread is keyed by its headers; Graph doesn't always return
// them, so Outlook falls back to its conversation id, which threads within
// Outlook but not across to Gmail.

const BASE = "https://graph.microsoft.com/v1.0/me";

const MAX_MESSAGES_PER_CHECK = 120;
const PAGE_SIZE = 50;
const OVERLAP_MS = 1_000;
const EXCLUDED_FOLDERS = ["junkemail", "deleteditems"] as const;
const CONVERSATION_ROOT_PREFIX = "outlook-conversation:";

const MESSAGE_FIELDS = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "from",
  "sender",
  "toRecipients",
  "ccRecipients",
  "receivedDateTime",
  "sentDateTime",
  "body",
  "bodyPreview",
  "internetMessageHeaders",
  "parentFolderId",
  "webLink",
].join(",");

const addressSchema = z.object({
  emailAddress: z
    .object({
      name: z.string().nullish(),
      address: z.string().nullish(),
    })
    .nullish(),
});

type GraphAddress = z.infer<typeof addressSchema>;

const messageSchema = z.object({
  id: z.string().optional(),
  internetMessageId: z.string().nullish(),
  conversationId: z.string().nullish(),
  subject: z.string().nullish(),
  from: addressSchema.nullish(),
  sender: addressSchema.nullish(),
  toRecipients: z.array(addressSchema).nullish(),
  ccRecipients: z.array(addressSchema).nullish(),
  receivedDateTime: z.string().nullish(),
  sentDateTime: z.string().nullish(),
  body: z
    .object({
      contentType: z.string().nullish(),
      content: z.string().nullish(),
    })
    .nullish(),
  bodyPreview: z.string().nullish(),
  internetMessageHeaders: z
    .array(
      z.object({ name: z.string().nullish(), value: z.string().nullish() }),
    )
    .nullish(),
  parentFolderId: z.string().nullish(),
  webLink: z.string().nullish(),
});

type GraphMessage = z.infer<typeof messageSchema>;

const pageSchema = z.object({
  value: z.array(messageSchema).optional(),
  "@odata.nextLink": z.string().optional(),
});

const userSchema = z.object({
  mail: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
});

const folderSchema = z.object({ id: z.string().optional() });

/** The signed-in account's address. */
export async function graphMe(accessToken: string, budget: SyncJob["budget"]) {
  return mailboxGet(BASE, accessToken, userSchema, budget, {
    $select: "mail,userPrincipalName",
  });
}

export async function syncOutlook(job: SyncJob): Promise<SyncResult> {
  const { row, accessToken, budget } = job;
  if (!row.cursor) {
    console.log("[mailbox] outlook watching for new mail", {
      organizationId: row.organizationId,
      userId: row.userId,
    });
    return { status: "IDLE", cursor: new Date().toISOString() };
  }
  const from = new Date(row.cursor);
  if (Number.isNaN(from.getTime())) return { status: "IDLE", cursor: null };

  const excluded = new Set<string>();
  for (const name of EXCLUDED_FOLDERS) {
    const folder = await mailboxGet(
      `${BASE}/mailFolders/${name}`,
      accessToken,
      folderSchema,
      budget,
      { $select: "id" },
    );
    if (folder.outcome === "ok") {
      if (folder.data.id) excluded.add(folder.data.id);
      continue;
    }
    // A mailbox without that folder has nothing in it.
    if (folder.outcome === "cursor-invalid") continue;
    return failureOf(folder);
  }

  let furthest = from;
  let seen = 0;
  let page: MailboxResult<z.infer<typeof pageSchema>> = await mailboxGet(
    `${BASE}/messages`,
    accessToken,
    pageSchema,
    budget,
    {
      $select: MESSAGE_FIELDS,
      $filter: `receivedDateTime gt ${new Date(from.getTime() - OVERLAP_MS).toISOString()} and isDraft eq false`,
      $orderby: "receivedDateTime asc",
      $top: PAGE_SIZE,
    },
  );

  while (page.outcome === "ok") {
    const messages = (page.data.value ?? []).slice(
      0,
      Math.max(MAX_MESSAGES_PER_CHECK - seen, 0),
    );
    for (const message of messages) {
      seen += 1;
      const receivedAt = message.receivedDateTime
        ? new Date(message.receivedDateTime)
        : null;
      if (
        receivedAt &&
        !Number.isNaN(receivedAt.getTime()) &&
        receivedAt > furthest
      ) {
        furthest = receivedAt;
      }
      if (message.parentFolderId && excluded.has(message.parentFolderId)) {
        continue;
      }
      const parsed = parseGraphMessage(message);
      if (parsed) {
        await CaptureService.storeMessage(
          job.capture,
          parsed,
          await job.context(),
        );
      }
    }
    const nextLink = page.data["@odata.nextLink"];
    if (!nextLink || seen >= MAX_MESSAGES_PER_CHECK || !budgetLeft(budget)) {
      break;
    }
    if (!nextLink.startsWith("https://graph.microsoft.com/")) break;
    page = await mailboxGet(nextLink, accessToken, pageSchema, budget);
  }
  if (page.outcome !== "ok") return failureOf(page, furthest.toISOString());
  return { status: "IDLE", cursor: furthest.toISOString() };
}

function addressOf(entry: GraphAddress | null | undefined): Participant | null {
  const address = entry?.emailAddress?.address?.trim();
  if (!address) return null;
  const name = entry?.emailAddress?.name?.trim();
  return parseAddress(name ? `${name} <${address}>` : address);
}

function addressList(
  entries: GraphAddress[] | null | undefined,
  kind: "to" | "cc",
) {
  const seen = new Set<string>();
  return (entries ?? []).flatMap((entry) => {
    const person = addressOf(entry);
    if (!person || seen.has(person.email)) return [];
    seen.add(person.email);
    return [{ ...person, kind }];
  });
}

function rootIdOf(message: GraphMessage, internetMessageId: string): string {
  const headers = message.internetMessageHeaders ?? [];
  const value = (name: string) =>
    headers
      .find((entry) => entry.name?.toLowerCase() === name)
      ?.value?.trim() || null;
  const references = value("references");
  const inReplyTo = value("in-reply-to");
  if (references || inReplyTo) {
    const root = rootMessageIdFrom({
      references,
      inReplyTo,
      messageId: internetMessageId,
    });
    if (root) return root;
  }
  if (message.conversationId) {
    return `${CONVERSATION_ROOT_PREFIX}${message.conversationId}`;
  }
  return normaliseMessageId(internetMessageId);
}

function sentAtOf(message: GraphMessage): string | null {
  for (const raw of [message.sentDateTime, message.receivedDateTime]) {
    if (!raw) continue;
    const at = new Date(raw);
    if (!Number.isNaN(at.getTime())) return at.toISOString();
  }
  return null;
}

/** A Graph message as the pipeline files it; null without the headers it needs. */
function parseGraphMessage(message: GraphMessage): IncomingMessage | null {
  const internetMessageId = message.internetMessageId?.trim();
  if (!internetMessageId) return null;
  const from = addressOf(message.from ?? message.sender);
  if (!from) return null;
  const sentAt = sentAtOf(message);
  if (!sentAt) return null;
  const raw = message.body?.content ?? message.bodyPreview ?? "";
  const text =
    message.body?.contentType?.toLowerCase() === "html" ? stripHtml(raw) : raw;
  return {
    rfcMessageId: normaliseMessageId(internetMessageId),
    rootId: rootIdOf(message, internetMessageId),
    subject: message.subject?.trim() || null,
    from,
    recipients: [
      ...addressList(message.toRecipients, "to"),
      ...addressList(message.ccRecipients, "cc"),
    ],
    body: messageBody(text),
    sentAt,
    outlookMessageId: message.id ?? null,
    outlookWebLink: message.webLink ?? null,
  };
}
