/**
 * Asks the dispatcher to look at `organizationId`'s queue now instead of on
 * the next minute's tick, so a new company's logo appears as it is added.
 * Phase 3 wires this to the dispatcher; until then the minute cron is the
 * only trigger.
 */
export function pokeDispatcher(_organizationId: string): void {}
