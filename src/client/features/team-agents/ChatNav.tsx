import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Bot, CircleCheck, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  SectionNavGroup,
  SectionNavLink,
} from "@/client/components/SectionLayout";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/client/components/ui/sheet";
import { deleteBuilderChat } from "@/serverFunctions/teamAgents";
import type { listBuilderChats } from "@/serverFunctions/teamAgents";
import {
  builderChatsQueryOptions,
  teamAgentKeys,
  teamAgentsQueryOptions,
} from "./teamAgentQueries";

type Chat = Awaited<ReturnType<typeof listBuilderChats>>[number];

const DAY_MS = 86_400_000;
const GROUPS = ["Today", "Yesterday", "Last 7 days"] as const;

/** Which of the column's date groups a chat falls in, if any. */
function dateGroup(lastMessageAt: string, now: number) {
  const daysAgo =
    Math.floor(now / DAY_MS) -
    Math.floor(new Date(lastMessageAt).getTime() / DAY_MS);
  if (daysAgo <= 0) return GROUPS[0];
  if (daysAgo === 1) return GROUPS[1];
  if (daysAgo <= 7) return GROUPS[2];
  return null;
}

/**
 * Chat's own column: the person's builder chats of the last week by day,
 * then the team's agents. Below `md` it is a strip, and the lists open in a
 * sheet.
 */
export function ChatNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden min-h-0 flex-col gap-4 md:flex">
        <ChatNavLists />
      </div>
      <div className="flex items-center gap-1 md:hidden">
        <SectionNavLink to="/chat" activeOptions={{ exact: true }}>
          <Plus aria-hidden />
          New chat
        </SectionNavLink>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="sm" className="h-8" />}
          >
            Chats
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 p-3">
            <SheetHeader className="sr-only">
              <SheetTitle>Chats and team agents</SheetTitle>
            </SheetHeader>
            <div
              className="flex flex-col gap-4"
              // A link in the sheet closes it on the way to its page.
              onClickCapture={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("a")
                ) {
                  setOpen(false);
                }
              }}
            >
              <ChatNavLists />
            </div>
          </SheetContent>
        </Sheet>
        <SectionNavLink to="/agents">Team agents</SectionNavLink>
      </div>
    </>
  );
}

function ChatNavLists() {
  const chats = useQuery({
    ...builderChatsQueryOptions(),
    refetchInterval: 30_000,
  });
  const agents = useQuery(teamAgentsQueryOptions());
  const now = chats.dataUpdatedAt;
  const grouped = GROUPS.map((label) => ({
    label,
    chats: (chats.data ?? []).filter(
      (chat) => now > 0 && dateGroup(chat.lastMessageAt, now) === label,
    ),
  })).filter((group) => group.chats.length > 0);

  return (
    <>
      <SectionNavGroup
        label="Chats"
        action={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New chat"
            nativeButton={false}
            render={<Link to="/chat" />}
          >
            <Plus />
          </Button>
        }
      >
        {grouped.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <span className="px-2.5 pt-2 pb-0.5 text-xs text-muted-foreground">
              {group.label}
            </span>
            {group.chats.map((chat) => (
              <ChatLink key={chat.id} chat={chat} />
            ))}
          </div>
        ))}
        {chats.isSuccess && grouped.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">
            No chats in the last 7 days.
          </p>
        ) : null}
      </SectionNavGroup>

      <SectionNavGroup
        className="border-t border-border pt-3"
        label={
          <Link to="/agents" className="hover:text-foreground">
            Team agents
          </Link>
        }
        action={
          agents.data ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {agents.data.length}
            </span>
          ) : null
        }
      >
        {(agents.data ?? []).map((agent) => (
          <SectionNavLink
            key={agent.id}
            to="/agents/$agentId"
            params={{ agentId: agent.id }}
          >
            <Bot aria-hidden />
            <span className="min-w-0 truncate">{agent.name}</span>
          </SectionNavLink>
        ))}
      </SectionNavGroup>
    </>
  );
}

function ChatLink({ chat }: { chat: Chat }) {
  const title = chat.title ?? "New chat";
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useParams({ strict: false, select: (p) => p.chatId });
  const remove = useMutation({
    mutationFn: () => deleteBuilderChat({ data: { conversationId: chat.id } }),
    onSuccess: async () => {
      setConfirming(false);
      toast.success("Chat deleted.");
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
      if (current === chat.id) await navigate({ to: "/chat" });
    },
  });

  return (
    <div className="group relative flex min-w-0 items-center">
      <SectionNavLink
        to="/chat/$chatId"
        params={{ chatId: chat.id }}
        className="flex-1 pr-8"
      >
        <ChatState chat={chat} />
        <span className="min-w-0 truncate">{title}</span>
      </SectionNavLink>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete ${title}`}
        className="reveal-on-hover absolute right-1"
        onClick={() => setConfirming(true)}
      >
        <X />
      </Button>
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${title}?`}
          confirmLabel="Delete chat"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        >
          This permanently deletes the chat, its messages and attachments. Any
          agent created from it stays available.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** An unread reply, or the agent the chat made is live. */
function ChatState({ chat }: { chat: Chat }) {
  if (chat.unread) {
    return (
      <span className="flex size-4 items-center justify-center">
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="sr-only">Unread</span>
      </span>
    );
  }
  if (chat.madeAgent?.status === "LIVE") {
    return <CircleCheck className="text-primary" aria-label="Deployed" />;
  }
  return null;
}
