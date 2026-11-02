/* ═══════════════════════════════════════════════════════════════════════
   Blacklist monitoring for the Sending health page.

   Each sending domain is looked up on the domain blocklists, and each
   mailbox's own mail server (not Gmail's or Microsoft's shared ones) on
   the IP blocklists. The lookups are DNS, so free, and the reading of
   each answer lives in shared/blacklists, where the traps are explained.

   Answers are kept for six hours: listings change slowly, and the page is
   opened far more often than that.
   ═══════════════════════════════════════════════════════════════════════ */

import { env } from '../config/env.js';
import { resolveDetailed, resolveHostIp } from '../utils/dns-doh.js';
import {
  BLOCKLISTS, blocklistQuery, isSharedMailHost, readBlocklistAnswer,
  type BlacklistHit, type BlacklistStatus, type BlocklistDef, type BlocklistKind, type BlocklistReading,
} from '@lemlist/shared';

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED = 2000;
const cache = new Map<string, { at: number; value: Promise<TargetResult> }>();

interface TargetResult { target: string; kind: BlocklistKind; readings: { list: string; id: string; reading: BlocklistReading; delist_url: string }[]; at: string }

type Resolve = typeof resolveDetailed;

async function readOne(list: BlocklistDef, target: string, resolve: Resolve): Promise<BlocklistReading> {
  const name = blocklistQuery(target, list, env.SPAMHAUS_DQS_KEY || undefined);
  if (!name) return 'unchecked';
  try {
    const answer = await resolve(name, 'A');
    return readBlocklistAnswer(list.id, answer.status, answer.records);
  } catch {
    return 'unchecked';
  }
}

/* Whether each list is really answering: its test entry must read as listed. */
const liveness = new Map<string, { at: number; value: Promise<boolean> }>();
function listAnswers(list: BlocklistDef, resolve: Resolve, fresh: boolean): Promise<boolean> {
  const hit = liveness.get(list.id);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = readOne(list, list.test_target, resolve).then((r) => r === 'listed');
  if (!fresh) liveness.set(list.id, { at: Date.now(), value });
  return value;
}

/** Every list of the target's kind, in parallel. Exported for the checks (which pass their own resolver). */
export async function lookupTarget(target: string, kind: BlocklistKind, resolve: Resolve = resolveDetailed): Promise<TargetResult> {
  const lists = BLOCKLISTS.filter((l) => l.kind === kind);
  const fresh = resolve !== resolveDetailed;
  const readings = await Promise.all(lists.map(async (list) => {
    const [reading, live] = await Promise.all([readOne(list, target, resolve), listAnswers(list, resolve, fresh)]);
    // A list that won't report its own test entry isn't answering, so its
    // "not listed" means nothing.
    return { list: list.name, id: list.id, reading: live || reading === 'listed' ? reading : 'unchecked' as BlocklistReading, delist_url: list.delist_url };
  }));
  return { target, kind, readings, at: new Date().toISOString() };
}

function cached(target: string, kind: BlocklistKind): Promise<TargetResult> {
  const key = `${kind}:${target}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  const value = lookupTarget(target, kind);
  cache.set(key, { at: Date.now(), value });
  // A failed lookup is not kept: the next page load tries again.
  value.catch(() => cache.delete(key));
  return value;
}

/** Fold one or two targets' readings into what the page shows. */
export function summarise(results: TargetResult[], serverIp: string | null): BlacklistStatus {
  const listed: BlacklistHit[] = [];
  const unchecked = new Set<string>();
  let answered = 0;
  for (const r of results) {
    for (const x of r.readings) {
      if (x.reading === 'listed') listed.push({ list: x.list, target: r.target, kind: r.kind, delist_url: x.delist_url });
      if (x.reading === 'unchecked') unchecked.add(x.list);
      else answered++;
    }
  }
  return {
    checked: answered > 0,
    listed,
    checked_count: answered,
    unchecked: [...unchecked],
    server_ip: serverIp,
    checked_at: results.map((r) => r.at).sort()[0] ?? null,
  };
}

export const blacklistService = {
  /**
   * A mailbox's domain and, when it sends through its own server, that
   * server's IP. Never throws and never takes long: anything unanswered in
   * time reads as "could not check", not as clean.
   */
  async forMailbox(domain: string, smtpHost: string | null, budgetMs = 8000): Promise<BlacklistStatus | null> {
    if (!domain) return null;
    const work = (async () => {
      const own = smtpHost && !isSharedMailHost(smtpHost) && !isSharedMailHost(domain) ? smtpHost : null;
      const ip = own ? (/^\d+\.\d+\.\d+\.\d+$/.test(own) ? own : await resolveHostIp(own).catch(() => null)) : null;
      const results = await Promise.all([cached(domain.toLowerCase(), 'domain'), ...(ip ? [cached(ip, 'ip')] : [])]);
      return summarise(results, ip);
    })();
    const late = new Promise<null>((r) => setTimeout(() => r(null), budgetMs));
    return Promise.race([work.catch(() => null), late]);
  },
};
