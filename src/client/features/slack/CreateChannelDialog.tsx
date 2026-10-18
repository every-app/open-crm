import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FormDialog } from "@/client/components/FormDialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { createSlackChannel } from "@/serverFunctions/slack";
import { slackKeys } from "./slackQueries";

/** Creates a Slack channel the app is in (the CRM's create-channel dialog). */
export function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
  const valid = /^[a-z0-9_-]+$/.test(slug);
  const create = useMutation({
    mutationFn: () => createSlackChannel({ data: { name: slug, isPrivate } }),
    onSuccess: async (result) => {
      if (!result.created) {
        toast.error(result.reason);
        return;
      }
      toast.success(`Created #${result.channel.name}.`);
      await queryClient.invalidateQueries({ queryKey: slackKeys.all });
      onClose();
    },
  });
  return (
    <FormDialog
      title="Create a channel"
      onClose={onClose}
      actions={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={!valid}
            pending={create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-channel-name">Name</Label>
          <Input
            id="new-channel-name"
            value={name}
            placeholder="renewals"
            onChange={(event) => setName(event.target.value)}
          />
          {slug && !valid ? (
            <p className="text-xs text-muted-foreground">
              Use lowercase letters, numbers and dashes.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="new-channel-private"
            checked={isPrivate}
            onCheckedChange={setIsPrivate}
          />
          <Label htmlFor="new-channel-private">Private</Label>
        </div>
      </div>
    </FormDialog>
  );
}
