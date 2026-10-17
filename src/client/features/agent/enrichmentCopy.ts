import { useSyncExternalStore } from "react";
import { ENRICHMENT_PAGE_MAX } from "@/types/schemas/agent";
import type { TaskKind } from "@/shared/agent-tasks";

// How the agent's queue reads, ported from the CRM's enrichment-copy.ts and
// lib/enrichment-queue.ts: what each kind of task is doing, when a booked one
// is due, how long a running one has run.

/** Running under a live lease, waiting its turn, or out of attempts. */
export type QueueState = "running" | "queued" | "failed";

const STEPS = {
  brand: "Fetching the logo",
  portrait: "Finding their photo",
  "meeting-prep": "Getting ready for your meeting",
  identify: "Reading their profile",
  profile: "Reading their profile",
  recheck: "Checking for anything new",
  "company-profile": "Reading the company website",
  "workspace-profile": "Reading your own website",
  "field-backfill": "Filling in the blank details",
} satisfies Record<TaskKind, string>;

const STEP_BY_KIND = new Map<string, string>(Object.entries(STEPS));

/** What a task of `kind` is doing: "Reading their profile". */
export function enrichmentStep(kind: string): string {
  return STEP_BY_KIND.get(kind) ?? "Looking them up";
}

/** A queue row's line: the step while it runs. */
export function queueLine(state: QueueState, kind: string): string {
  if (state === "queued") return "Waiting";
  if (state === "failed") return "Could not look this up";
  return enrichmentStep(kind);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a booked task comes round: "Tomorrow", "In 3 weeks". */
export function dueLabel(dueAt: string, now: number): string {
  const ahead = Date.parse(dueAt) - now;
  if (Number.isNaN(ahead) || ahead < DAY_MS) return "Later today";
  const days = Math.floor(ahead / DAY_MS);
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

const pad = (value: number) => value.toString().padStart(2, "0");

/** How long a running task has run: "4:07", "1:02:09"; a dash otherwise. */
export function elapsedLabel(
  state: QueueState,
  startedAt: string | null,
  now: number,
): string {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (state === "queued" || Number.isNaN(started)) return "—";
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor((seconds % 3600) / 60);
  if (seconds < 3600) return `${minutes}:${pad(seconds % 60)}`;
  return `${Math.floor(seconds / 3600)}:${pad(minutes)}:${pad(seconds % 60)}`;
}

/**
 * The queue's footer: how many rows are not on screen, and whether showing
 * them takes expanding the list ("show-all") or fetching more ("load-more").
 */
export function queueFooter(input: {
  total: number;
  fetched: number;
  shown: number;
  limit: number;
}): { more: number; action: "show-all" | "load-more" | "none" } {
  const more = Math.max(0, input.total - input.shown);
  if (more === 0) return { more: 0, action: "none" };
  if (input.fetched > input.shown) return { more, action: "show-all" };
  return {
    more,
    action: input.limit < ENRICHMENT_PAGE_MAX ? "load-more" : "none",
  };
}

// One clock for every elapsed time on screen, ticking once a second while
// anything reads it (the CRM's useSeconds).
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The time now, updated every second; 0 while server rendering. */
export function useSeconds(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}
