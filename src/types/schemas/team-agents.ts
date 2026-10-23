import { z } from "zod";
import { CAPTURE_KINDS } from "@/shared/team-agents";

const id = z.string().trim().min(1).max(128);
const requestId = z.uuid();

/**
 * The longest name and description a person gives an agent, as the CRM's
 * agents.update took them (and its New agent the name); its builder's drafts
 * stay shorter.
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

export const builderResourcesSchema = z.object({
  q: z.string().max(120).default(""),
});
