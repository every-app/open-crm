import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { SlackService } from "@/server/features/slack/services/SlackService";
import {
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  SLACK_RESOURCE,
  slackChannelResourceId,
} from "@/shared/team-agents";
import { BuilderResourceRepository } from "../repositories/BuilderResourceRepository";
import { BuilderToolService } from "./BuilderToolService";

// What the builder chat's composer offers to tag, ported from the CRM's
// builder resources: the organization's records, the integrations it has
// connected, and its Slack channels.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

/** How many records of each kind the tag picker offers. */
const TAGGABLE_PER_KIND = 6;

type Picture = {
  url: string | null;
  darkUrl: string | null;
  tone: string | null;
};

const NO_PICTURE: Picture = { url: null, darkUrl: null, tone: null };

/**
 * Records and integrations a person can tag in the composer, as the CRM's
 * builder resources: before they type, the most recently active companies,
 * contacts and deals. Email, Calendar and Slack are offered once someone has
 * connected them, and once they type, the Slack channels that match.
 */
async function search(context: Context, q: string) {
  const term = q.trim();
  const [records, slack, capture] = await Promise.all([
    BuilderResourceRepository.taggableRecords(
      context.organizationId,
      term,
      TAGGABLE_PER_KIND,
    ),
    SlackService.isConnected(context.organizationId),
    BuilderToolService.captureConnections(context.organizationId),
  ]);
  const channelTerm = term.replace(/^#/, "");
  const channels =
    slack && channelTerm
      ? (
          await SlackInventoryService.channels(context, {
            query: channelTerm,
            offset: 0,
          })
        ).rows.slice(0, TAGGABLE_PER_KIND)
      : [];
  const matches = (label: string) =>
    !term || label.toLowerCase().includes(term.toLowerCase());
  return [
    ...CAPTURE_KINDS.filter(
      (kind) => capture[kind] && matches(CAPTURE_GRANTS[kind].resource.label),
    ).map((kind) => ({
      kind: "integration" as const,
      id: CAPTURE_GRANTS[kind].resource.id,
      label: CAPTURE_GRANTS[kind].resource.label,
      detail: null,
      picture: NO_PICTURE,
    })),
    ...(slack && matches("slack")
      ? [
          {
            kind: "integration" as const,
            id: SLACK_RESOURCE.id,
            label: SLACK_RESOURCE.label,
            detail: null,
            picture: NO_PICTURE,
          },
        ]
      : []),
    ...channels.map((channel) => ({
      kind: "integration" as const,
      id: slackChannelResourceId(channel.id),
      label: `#${channel.name}`,
      detail: null,
      picture: NO_PICTURE,
    })),
    ...records.companies.map((row) => ({
      kind: "company" as const,
      id: row.id,
      label: row.name,
      detail: row.domain,
      picture: {
        url: row.iconUrl,
        darkUrl: row.iconDarkUrl,
        tone: row.iconTone,
      },
    })),
    ...records.contacts.map((row) => ({
      kind: "contact" as const,
      id: row.id,
      label:
        [row.firstName, row.lastName].filter(Boolean).join(" ") ||
        (row.email ?? "Unnamed"),
      detail: row.companyName ?? row.email,
      picture: { ...NO_PICTURE, url: row.imageUrl },
    })),
    ...records.deals.map((row) => ({
      kind: "deal" as const,
      id: row.id,
      label: row.name,
      detail: row.companyName,
      picture: {
        url: row.iconUrl,
        darkUrl: row.iconDarkUrl,
        tone: row.iconTone,
      },
    })),
  ];
}

export const BuilderResourceService = { search };
