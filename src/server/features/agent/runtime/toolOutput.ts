// Every tool result the agent sees is persisted into the session and re-sent
// to the model on each later step of the turn, so one oversized payload (ten
// threads of email bodies) is paid for many times, and it is how long OpenSEO
// SAM turns outgrew the Durable Object memory limit. Ported from OpenSEO's
// samToolOutput.ts: trim any result over the budget before the model sees it
// and say what was dropped, so the model narrows the request instead of
// guessing.

const MAX_TOOL_OUTPUT_CHARS = 32_000;
const MAX_STRING_CHARS = 8_000;
const MIN_STRING_CHARS = 500;
const NOTE_BUDGET_CHARS = 600;

type Trim = {
  path: string;
  kept: number;
  total: number;
  unit: "rows" | "chars";
};

type Slot = { parent: object; key: string | number; path: string };

const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

function slots(value: unknown, path = ""): Slot[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) => {
      const itemPath = `${path}[${index}]`;
      const here: Slot[] =
        Array.isArray(item) || typeof item === "string"
          ? [{ parent: value, key: index, path: itemPath }]
          : [];
      return [...here, ...slots(item, itemPath)];
    });
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]: [string, unknown]) => {
      const itemPath = path ? `${path}.${key}` : key;
      const here: Slot[] =
        Array.isArray(item) || typeof item === "string"
          ? [{ parent: value, key, path: itemPath }]
          : [];
      return [...here, ...slots(item, itemPath)];
    });
  }
  return [];
}

const read = (slot: Slot): unknown => Reflect.get(slot.parent, slot.key);
const write = (slot: Slot, value: unknown): void => {
  Reflect.set(slot.parent, slot.key, value);
};

// Trims are keyed per shape, not per element: 500 shortened `rows[i].body`
// strings are one note line, `rows[*].body`.
const shape = (path: string): string => path.replace(/\[\d+\]/g, "[*]");

function note(trims: Trim[]): string {
  const parts = trims.map((trim) =>
    trim.unit === "rows"
      ? `\`${trim.path}\` shows ${trim.kept} of ${trim.total} rows`
      : `\`${trim.path}\` shortened to ${trim.kept} chars`,
  );
  const text = `Output trimmed to fit the context: ${parts.join("; ")}. Narrow the request (a smaller limit, fewer threads) to see the rest.`;
  return text.length > NOTE_BUDGET_CHARS
    ? `${text.slice(0, NOTE_BUDGET_CHARS - 1)}…`
    : text;
}

/**
 * `value` unchanged when it serializes under `maxChars`; otherwise a trimmed
 * copy: long strings capped first, then the largest array halved (keeping
 * the head: results come ordered by relevance) until it fits, then the
 * longest string, with a `truncated` note listing what was cut.
 */
export function capToolOutput(
  value: unknown,
  maxChars = MAX_TOOL_OUTPUT_CHARS,
): unknown {
  if (size(value) <= maxChars) return value;
  const budget = maxChars - NOTE_BUDGET_CHARS;
  const copy: unknown = structuredClone(value);
  const trims = new Map<string, Trim>();
  const record = (
    slot: Slot,
    kept: number,
    total: number,
    unit: Trim["unit"],
  ) => {
    const path = shape(slot.path);
    const existing = trims.get(path);
    trims.set(path, {
      path,
      kept: existing ? Math.min(existing.kept, kept) : kept,
      total: existing ? Math.max(existing.total, total) : total,
      unit,
    });
  };
  for (const slot of slots(copy)) {
    const item = read(slot);
    if (typeof item === "string" && item.length > MAX_STRING_CHARS) {
      write(slot, item.slice(0, MAX_STRING_CHARS));
      record(slot, MAX_STRING_CHARS, item.length, "chars");
    }
  }
  while (size(copy) > budget) {
    let largest: { slot: Slot; item: unknown[] } | undefined;
    for (const slot of slots(copy)) {
      const item = read(slot);
      if (!Array.isArray(item) || item.length <= 1) continue;
      if (!largest || size(item) > size(largest.item)) largest = { slot, item };
    }
    if (!largest) break;
    const kept = Math.ceil(largest.item.length / 2);
    write(largest.slot, largest.item.slice(0, kept));
    record(largest.slot, kept, largest.item.length, "rows");
  }
  while (size(copy) > budget) {
    let longest: { slot: Slot; item: string } | undefined;
    for (const slot of slots(copy)) {
      const item = read(slot);
      if (typeof item !== "string" || item.length <= MIN_STRING_CHARS) continue;
      if (!longest || item.length > longest.item.length)
        longest = { slot, item };
    }
    if (!longest) break;
    const kept = Math.max(MIN_STRING_CHARS, Math.ceil(longest.item.length / 2));
    write(longest.slot, longest.item.slice(0, kept));
    record(longest.slot, kept, longest.item.length, "chars");
  }
  const truncated = note([...trims.values()]);
  return typeof copy === "object" && copy !== null && !Array.isArray(copy)
    ? { ...copy, truncated }
    : { data: copy, truncated };
}
