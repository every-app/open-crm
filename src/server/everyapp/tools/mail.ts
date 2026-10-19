import { z } from "zod";
import { crmTool, fullName, recordRefOutput } from "@/server/everyapp/crm-tool";
import { ActivityService } from "@/server/features/activities/services/ActivityService";
import { ConnectionService } from "@/server/features/mailbox/services/ConnectionService";
import { MAILBOX_PROVIDERS, SYNC_SOURCES } from "@/shared/mailbox";
import { suppressDomainSchema } from "@/types/schemas/mailbox";

// Captured mail and calendar for AI clients: a thread's messages and a
// meeting's attendees behind a timeline's EMAIL and MEETING entries
// (list_activities finds them), the caller's own connections (checking them
// now, and whether each adds people), and suppressing a domain. Connecting a
// mailbox is an OAuth flow in the browser, so it stays in Settings →
// Connections; so do deleting synced data and disconnecting.

/** A thread's newest messages, and how much of each body, a call returns. */
const THREAD_MESSAGES = 20;
const BODY_CHARS = 4000;

function cut(text: string | null) {
  return text && text.length > BODY_CHARS
    ? `${text.slice(0, BODY_CHARS - 1)}…`
    : text;
}

const capturedId = (what: string, from: string) =>
  z.string().min(1).describe(`The ${what}'s id, from ${from}.`);

const filedOnOutput = {
  company: recordRefOutput.nullable(),
  contact: recordRefOutput.nullable(),
};

/** The company and contact a thread or meeting is filed on, by id and name. */
function filedOn(item: {
  company: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string | null } | null;
}) {
  return {
    company: item.company,
    contact: item.contact
      ? { id: item.contact.id, name: fullName(item.contact) }
      : null,
  };
}

export const mailTools = {
  get_email_thread: crmTool({
    description: `One captured email thread: its subject, the company and contact it is filed on, and its newest ${THREAD_MESSAGES} messages, oldest first, each with sender, recipients and text (cut at ${BODY_CHARS.toLocaleString("en")} characters). list_activities with filter "email" gives thread ids.`,
    risk: "read",
    input: z
      .object({
        threadId: capturedId("thread", 'list_activities\' email "threadId"'),
      })
      .strict(),
    output: z.object({
      id: z.string(),
      subject: z.string().nullable(),
      ...filedOnOutput,
      messageCount: z.number(),
      messages: z.array(
        z.object({
          direction: z.string().describe("INBOUND or OUTBOUND."),
          from: z.object({ email: z.string(), name: z.string().nullable() }),
          to: z.array(
            z.object({
              email: z.string(),
              name: z.string().nullable(),
              kind: z.string().describe("to, cc or bcc."),
            }),
          ),
          sentAt: z.string(),
          text: z.string().nullable(),
        }),
      ),
    }),
    handler: async ({ threadId }, context) => {
      const thread = await ActivityService.emailThread(
        context.organizationId,
        threadId,
      );
      return {
        ...thread,
        ...filedOn(thread),
        messages: thread.messages.slice(-THREAD_MESSAGES).map((message) => ({
          direction: message.direction,
          from: { email: message.fromEmail, name: message.fromName },
          to: message.recipients,
          sentAt: message.sentAt,
          text: cut(message.body ?? message.snippet),
        })),
      };
    },
  }),

  get_meeting: crmTool({
    description: `One captured meeting: when and where, what the invite says (cut at ${BODY_CHARS.toLocaleString("en")} characters), who organized it, the company and contact it is filed on, and who was invited with their answers (attendees in the CRM come with their contact id). list_activities with filter "meetings" gives meeting ids.`,
    risk: "read",
    input: z
      .object({
        meetingId: capturedId(
          "meeting",
          'list_activities\' meeting "meetingId"',
        ),
      })
      .strict(),
    output: z.object({
      id: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      startsAt: z.string(),
      endsAt: z.string(),
      isAllDay: z.boolean(),
      location: z.string().nullable(),
      conferenceUrl: z.string().nullable(),
      status: z.string().nullable(),
      organizerEmail: z.string().nullable(),
      ...filedOnOutput,
      attendees: z.array(
        z.object({
          email: z.string(),
          name: z.string().nullable(),
          response: z.string().nullable(),
          organizer: z.boolean(),
          contactId: z.string().nullable(),
        }),
      ),
    }),
    handler: async ({ meetingId }, context) => {
      const meeting = await ActivityService.meeting(
        context.organizationId,
        meetingId,
      );
      return {
        ...meeting,
        ...filedOn(meeting),
        description: cut(meeting.description),
        attendees: meeting.attendees.map((attendee) => ({
          ...attendee,
          response: attendee.responseStatus,
          organizer: attendee.isOrganizer,
        })),
      };
    },
  }),

  get_mailbox_status: crmTool({
    description:
      "The caller's own Google and Microsoft connections: whether this CRM offers each, the connected address, and for Gmail, Outlook and Calendar whether it syncs, when it last did and any error. Connecting happens in the CRM's Settings → Connections.",
    risk: "read",
    input: z.object({}).strict(),
    output: z.object({
      providers: z.array(
        z.object({
          provider: z.enum(MAILBOX_PROVIDERS),
          available: z.boolean(),
          connection: z
            .object({
              accountEmail: z.string(),
              needsReconnect: z.boolean(),
              sources: z.array(
                z.object({
                  source: z.enum(SYNC_SOURCES),
                  granted: z.boolean(),
                  status: z.string().nullable(),
                  lastSyncedAt: z.string().nullable(),
                  lastError: z.string().nullable(),
                  autoCreate: z
                    .boolean()
                    .describe("New people from it become contacts."),
                }),
              ),
            })
            .nullable(),
        }),
      ),
    }),
    handler: async (_input, context, { origin }) => {
      const { providers } = await ConnectionService.status(context, origin);
      return {
        providers: providers.map((provider) => ({
          ...provider,
          available: provider.ready,
        })),
      };
    },
  }),

  check_mailbox_now: crmTool({
    description:
      "Check the caller's Gmail and Google Calendar, or Outlook, within the minute instead of at its next five-minute check. Returns at once; get_mailbox_status says when each last synced.",
    risk: "write",
    input: z.object({ provider: z.enum(MAILBOX_PROVIDERS) }).strict(),
    output: z.object({
      sources: z.array(z.enum(SYNC_SOURCES)).describe("The sources queued."),
    }),
    handler: ({ provider }, context) =>
      ConnectionService.queueCheck(context, provider),
  }),

  set_mailbox_auto_create: crmTool({
    description:
      "Whether new people from the caller's Gmail, Google Calendar or Outlook become contacts, with their companies. Calendar starts on, Gmail and Outlook off.",
    risk: "write",
    input: z
      .object({ source: z.enum(SYNC_SOURCES), enabled: z.boolean() })
      .strict(),
    output: z.object({
      source: z.enum(SYNC_SOURCES),
      autoCreate: z.boolean(),
    }),
    handler: async ({ source, enabled }, context) => {
      await ConnectionService.setAutoCreate(context, source, enabled);
      return { source, autoCreate: enabled };
    },
  }),

  suppress_domain: crmTool({
    description:
      "Mark a domain as not a customer: its people stop becoming contacts from mail, meetings and website forms. Mail and meetings already filed stay. Your own domains are refused.",
    risk: "write",
    input: z
      .object({
        domain: suppressDomainSchema.shape.domain.describe(
          "The domain, like acme.com.",
        ),
        reason: suppressDomainSchema.shape.reason,
      })
      .strict(),
    output: z.object({ domain: z.string() }),
    handler: (input, context) =>
      ConnectionService.suppressDomain(context.organizationId, {
        ...input,
        purge: false,
      }),
  }),
};
