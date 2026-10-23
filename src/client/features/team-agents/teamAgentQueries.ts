import { queryOptions } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getTeamAgent,
  getTeamAgentActivity,
  getTeamAgentFiles,
  getTeamAgentRuns,
  listTeamAgents,
  searchBuilderResources,
} from "@/serverFunctions/teamAgents";

// Every team-agent query lives under ["team-agents"]. Runs are polled while
// one is queued or running, as the CRM's runs drawer did.

const ACTIVE_POLL_MS = 2_500;

export const teamAgentKeys = {
  all: ["team-agents"] as const,
  list: () => ["team-agents", "list"] as const,
  agent: (agentId: string) => ["team-agents", "agent", agentId] as const,
};

export const teamAgentsQueryOptions = () =>
  queryOptions({
    queryKey: teamAgentKeys.list(),
    queryFn: () => listTeamAgents(),
  });

/** A missing agent won't appear on a retry. */
const retryUnlessMissing = (failures: number, error: Error) =>
  getErrorCode(error) !== "NOT_FOUND" && failures < 3;

export const teamAgentQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: teamAgentKeys.agent(agentId),
    queryFn: () => getTeamAgent({ data: { agentId } }),
    retry: retryUnlessMissing,
  });

export const teamAgentFilesQueryOptions = (
  agentId: string,
  versionId: string,
) =>
  queryOptions({
    queryKey: [...teamAgentKeys.agent(agentId), "files", versionId],
    queryFn: () => getTeamAgentFiles({ data: { agentId, versionId } }),
    staleTime: Infinity,
  });

export const teamAgentRunsQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: [...teamAgentKeys.agent(agentId), "runs"],
    queryFn: () => getTeamAgentRuns({ data: { agentId, limit: 50 } }),
    refetchInterval: (query) =>
      query.state.data?.some(
        (run) => run.status === "QUEUED" || run.status === "RUNNING",
      )
        ? ACTIVE_POLL_MS
        : false,
  });

export const teamAgentActivityQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: [...teamAgentKeys.agent(agentId), "activity"],
    queryFn: () => getTeamAgentActivity({ data: { agentId, limit: 100 } }),
  });

export const builderResourcesQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ["team-agents", "resources", q],
    queryFn: () => searchBuilderResources({ data: { q } }),
    staleTime: 30_000,
  });
