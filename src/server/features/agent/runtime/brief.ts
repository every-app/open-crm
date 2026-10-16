import { fieldBackfillPayloadSchema } from "../services/AgentTaskService";
import type { ResearchSession } from "./session";

// The message a research session starts with, ported from the CRM's brief()
// in lib/dispatch.ts: what to do, by kind. The record, the reason and the
// budget are in the session's system prompt (preamble.ts).

/** The custom field keys a field-backfill task is for, if it is one. */
export function fieldKeysOf(task: ResearchSession["task"]): string[] | null {
  if (task.kind !== "field-backfill") return null;
  const parsed = fieldBackfillPayloadSchema.safeParse(task.payload);
  return parsed.success ? parsed.data.keys : null;
}

export function researchBrief(
  task: ResearchSession["task"],
  attempts: number,
): string {
  const again =
    attempts > 1
      ? `This is attempt ${attempts}; the earlier one did not finish. Carry on from what is already in this thread rather than starting again. `
      : "";
  return again + work(task);
}

function work(task: ResearchSession["task"]): string {
  switch (task.kind) {
    case "identify":
      return "Work out who this contact actually is, and record what you find. Read what we already have before spending anything.";
    case "profile":
    case "recheck":
      return "Bring this contact's record up to date: their background, their current role, and anything that has changed since we last looked.";
    case "meeting-prep":
      return "There is a meeting with this person soon. Make sure whoever is taking it opens the record knowing who they are dealing with.";
    case "company-profile":
      return "This company's brand, industry, location and links are filled in separately and may already be there. Read the account, fill anything still missing, and write a brief if there is something worth saying.";
    case "workspace-profile":
      return "Write the profile of the company you work for, so that every other session knows who we are. Read our own site and keep it short.";
    case "field-backfill": {
      const keys = fieldKeysOf(task)?.join(", ") ?? task.reason;
      return `This record is missing a value for the custom field(s) ${keys}. Call list_fields for this record's type, read each field's brief, and call set_field_value only where you find real evidence — leave it blank rather than guess.`;
    }
    default:
      return `Handle this: ${task.reason}`;
  }
}
