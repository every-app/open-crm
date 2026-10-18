import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyButton } from "@/client/components/CopyButton";
import { QueryError } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/Spinner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/client/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import { createChatShare, revokeChatShare } from "@/serverFunctions/sharing";
import { chatShareQueryOptions, sharingKeys } from "./sharingQueries";

/**
 * Shares one of the person's builder chats read-only (the CRM's
 * ShareChatDialog): only them, or anyone in the workspace with the link. Only
 * a hash of the link is kept, so it can be copied only right after it is
 * made; after that it can be replaced or revoked. Render it only while it is
 * open.
 */
export function ShareChatDialog({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const status = useQuery(chatShareQueryOptions(conversationId));
  // The link made while the dialog is open, the one time it can be shown.
  const [token, setToken] = useState<string | null>(null);
  const setShared = (shared: boolean) =>
    queryClient.setQueryData(sharingKeys.share(conversationId), { shared });
  const create = useMutation({
    mutationFn: () => createChatShare({ data: { conversationId } }),
    onSuccess: (created) => {
      setToken(created.token);
      setShared(true);
    },
  });
  const revoke = useMutation({
    mutationFn: () => revokeChatShare({ data: { conversationId } }),
    onSuccess: () => {
      setToken(null);
      setShared(false);
      toast.success("Chat link revoked.");
    },
  });
  const busy = create.isPending || revoke.isPending;
  const linked = status.data?.shared === true;
  const choice = create.isPending
    ? "link"
    : revoke.isPending || !linked
      ? "private"
      : "link";
  const url = token ? `${window.location.origin}/chat/shared/${token}` : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share chat</DialogTitle>
        </DialogHeader>
        {status.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : status.isError ? (
          <QueryError
            variant="inline"
            error={status.error}
            fallback="Sharing status could not be loaded."
            onRetry={() => void status.refetch()}
            isRetrying={status.isFetching}
          />
        ) : (
          <div className="space-y-3">
            <RadioGroup
              value={choice}
              disabled={busy}
              aria-label="Sharing"
              onValueChange={(value) => {
                if (value === "link" && !linked) create.mutate();
                if (value === "private" && linked) revoke.mutate();
              }}
            >
              <ShareChoice value="private" label="Only you" />
              <ShareChoice
                value="link"
                label="Anyone in the workspace with the link"
                detail="Read-only"
              />
            </RadioGroup>
            {revoke.isPending ? null : url ? (
              <InputGroup>
                <InputGroupInput
                  readOnly
                  value={url}
                  aria-label="Chat link"
                  className="font-mono text-xs md:text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <InputGroupAddon align="inline-end">
                  <CopyButton
                    value={url}
                    label="Copy link"
                    successMessage="Chat link copied."
                    size="sm"
                  />
                </InputGroupAddon>
              </InputGroup>
            ) : linked ? (
              <InputGroup>
                <InputGroupText className="flex-1 px-3">
                  An active link exists
                </InputGroupText>
                <InputGroupAddon align="inline-end">
                  <Button
                    variant="outline"
                    size="sm"
                    pending={create.isPending}
                    onClick={() => create.mutate()}
                  >
                    Replace link
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            ) : null}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            pending={revoke.isPending}
            disabled={!linked || create.isPending}
            onClick={() => revoke.mutate()}
          >
            Revoke link
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareChoice({
  value,
  label,
  detail,
}: {
  value: "private" | "link";
  label: string;
  detail?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 has-data-checked:border-primary has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60">
      <RadioGroupItem value={value} />
      <span className="min-w-0 text-sm">
        <span className="block font-medium">{label}</span>
        {detail ? (
          <span className="block text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </label>
  );
}
