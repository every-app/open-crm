import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { OUT_OF_CREDITS_REPLY, SETTINGS_BILLING_ROUTE } from "@/shared/billing";
import { useCanManageBilling, useCreditBalance } from "./billingQueries";
import { showOutOfCredits, useOutOfCreditsDialog } from "./outOfCredits";
import { BASE_PLAN_OFFER } from "./plan-offers";

/**
 * The one place running out of credits shows: a dialog every refusal opens
 * (outOfCredits.ts), with OpenSEO's offer. A free plan upgrades, a paid plan
 * buys credits; only the owner can, so anyone else is told to ask them.
 * Closed with its buttons, Escape, or a click outside it.
 */
export function OutOfCreditsDialog() {
  const { open, close } = useOutOfCreditsDialog();
  const { accountQuery, isFreePlan, refillDate } = useCreditBalance();
  const canManageBilling = useCanManageBilling();
  const loaded = accountQuery.data !== undefined;

  const description = !canManageBilling
    ? "Your organization has used its credits. Ask your organization owner to add more."
    : !loaded
      ? "Add credits on the Billing page to keep going."
      : isFreePlan
        ? `You've used your free credits. Upgrade to get $${BASE_PLAN_OFFER.monthlyCreditsUsd} of credits every month.`
        : refillDate
          ? `Buy more credits to keep going, or wait for your monthly credits to refill on ${refillDate}.`
          : "Buy more credits to keep going.";
  const action = !loaded
    ? "Go to Billing"
    : isFreePlan
      ? "Upgrade plan"
      : "Buy credits";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>You&rsquo;re out of credits</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Not now
          </Button>
          {canManageBilling ? (
            <Button
              nativeButton={false}
              render={<Link to={SETTINGS_BILLING_ROUTE} onClick={close} />}
            >
              {action}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Opens the dialog when a chat's new reply is the agent's refusal for
 * credits: a reply to a turn sent from this view. Replies already there when
 * the chat opened, or replayed when its socket reconnects, are history.
 */
export function useOutOfCreditsReplies(
  messages: UIMessage[],
  status: string,
): void {
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(messages.map((message) => message.id));
  const sent = useRef(false);
  useEffect(() => {
    if (status === "submitted" || status === "streaming") sent.current = true;
  }, [status]);
  useEffect(() => {
    const known = seen.current;
    if (!known || !sent.current) return;
    for (const message of messages) {
      if (message.role !== "assistant" || known.has(message.id)) continue;
      const text = message.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (text !== OUT_OF_CREDITS_REPLY) continue;
      known.add(message.id);
      showOutOfCredits();
    }
  }, [messages]);
}
