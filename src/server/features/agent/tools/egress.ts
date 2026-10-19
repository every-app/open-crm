import { z } from "zod";
import { normalizeUrl, safeHostname } from "@/shared/safe-url";
import type { RecordIds } from "../prompt/preamble";
import { AgentPeopleRepository } from "../repositories/AgentPeopleRepository";
import { AgentRecordRepository } from "../repositories/AgentRecordRepository";

// What a session nobody watches may send out: a research task, or a team
// agent's run. It reads text outsiders wrote (a website form, a calendar
// invite, a page), so a planted instruction must not be able to carry the
// CRM's data off. web_fetch is its one tool that reaches an address the model
// picks, so there it reads only its record's own site and the pages a web
// search returned in the session, by origin and path: a query string or a
// fragment never leaves. Once a research session has read captured mail or
// meetings it has no web_fetch at all, and neither does a run whose version
// may read them (team-agents/runtime/runnerTools.ts). A person's chat keeps
// the open web_fetch: they see every step.

/**
 * A research session's reads that decide what its web_fetch may do: whether
 * it has read captured mail or meetings, and which pages its web searches
 * returned. Kept in the session's own storage, so a retried attempt, which
 * continues the same transcript, is held to them too.
 */
export type Egress = {
  /** True once the session has read captured mail or meetings. */
  closed(): boolean;
  close(): void;
  /** The pages web searches returned in the session, by origin and path. */
  searched(): ReadonlySet<string>;
  noteSearched(urls: readonly string[]): void;
};

/** A CrmAgent's own synchronous storage (ctx.storage.kv). */
type SessionStorage = {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
};

const EGRESS_KEY = "crm-agent:egress";

/** Enough for every search of a session; the oldest go first. */
const MAX_SEARCHED = 200;

const egressState = z
  .object({ closed: z.boolean(), searched: z.array(z.string()) })
  .catch({ closed: false, searched: [] });

export function sessionEgress(storage: SessionStorage): Egress {
  const read = () => egressState.parse(storage.get(EGRESS_KEY));
  return {
    closed: () => read().closed,
    close: () => storage.put(EGRESS_KEY, { ...read(), closed: true }),
    searched: () => new Set(read().searched),
    noteSearched: (urls) => {
      const pages = urls.flatMap((url) => pageAddress(url) ?? []);
      if (pages.length === 0) return;
      const state = read();
      const searched = [...new Set([...state.searched, ...pages])];
      storage.put(EGRESS_KEY, {
        ...state,
        searched: searched.slice(-MAX_SEARCHED),
      });
    },
  };
}

/** What a session's unattended web_fetch may read. */
export type FetchScope = {
  /** The hosts of the session's records' own sites. */
  hosts(): Promise<readonly string[]>;
  /** The pages web searches returned in the session, by origin and path. */
  searched(): ReadonlySet<string>;
  /** False once the session may no longer fetch anything. */
  open(): boolean;
};

/** An http(s) URL as origin and path, or null for anything else. */
export function pageAddress(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * The page `raw` names, as origin and path, when it is on one of `hosts`
 * (or a subdomain) or is a page a search returned; otherwise null.
 */
export function scopedPage(
  raw: string,
  hosts: readonly string[],
  searched: ReadonlySet<string>,
): string | null {
  const page = pageAddress(raw);
  if (!page) return null;
  if (searched.has(page)) return page;
  const host = new URL(page).hostname.toLowerCase().replace(/\.$/, "");
  return hosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  )
    ? page
    : null;
}

/** A domain or website as a bare host ("acme.com"), or null. */
function hostOf(value: string | null): string | null {
  return value ? safeHostname(normalizeUrl(value)) : null;
}

/**
 * The hosts of the company a record is, or belongs to (a contact's company,
 * a deal's): its domain, and its website's host.
 */
export async function recordHosts(
  organizationId: string,
  record: RecordIds,
): Promise<string[]> {
  const companyId =
    record.companyId ??
    (record.contactId
      ? (await AgentPeopleRepository.subject(organizationId, record.contactId))
          ?.companyId
      : null) ??
    (record.dealId
      ? (
          await AgentRecordRepository.dealForPreamble(
            organizationId,
            record.dealId,
          )
        )?.company?.id
      : null);
  if (!companyId) return [];
  const site = await AgentRecordRepository.companySite(
    organizationId,
    companyId,
  );
  if (!site) return [];
  return [
    ...new Set(
      [hostOf(site.domain), hostOf(site.website)].flatMap((host) =>
        host ? [host] : [],
      ),
    ),
  ];
}
