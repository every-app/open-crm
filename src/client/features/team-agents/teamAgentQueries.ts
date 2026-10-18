import { queryOptions } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getBuilderChat,
  getTeamAgent,
  getTeamAgentActivity,
  getTeamAgentFiles,
  getTeamAgentRuns,
  listBuilderChats,
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
  chats: () => ["team-agents", "chats"] as const,
  chat: (conversationId: string) =>
    ["team-agents", "chat", conversationId] as const,
};

export const teamAgentsQueryOptions = () =>
  queryOptions({
    queryKey: teamAgentKeys.list(),
    queryFn: () => listTeamAgents(),
  });

export const teamAgentQueryOptions = (agentId: string) =>
  queryOptions({
    queryKey: teamAgentKeys.agent(agentId),
    queryFn: () => getTeamAgent({ data: { agentId } }),
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

export const builderChatsQueryOptions = () =>
  queryOptions({
    queryKey: teamAgentKeys.chats(),
    queryFn: () => listBuilderChats(),
  });

export const builderChatQueryOptions = (conversationId: string) =>
  queryOptions({
    queryKey: teamAgentKeys.chat(conversationId),
    queryFn: () => getBuilderChat({ data: { conversationId } }),
    // A chat that isn't there won't be on a retry.
    retry: (failures, error) =>
      getErrorCode(error) !== "NOT_FOUND" && failures < 3,
  });

export const builderResourcesQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ["team-agents", "resources", q],
    queryFn: () => searchBuilderResources({ data: { q } }),
    staleTime: 30_000,
  });
