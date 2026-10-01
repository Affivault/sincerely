/* ═══════════════════════════════════════════════════════════════════════
   What inbox sync saw of a running reply check.

   The check sends, then asks inbox sync to read; sync reports here when it
   meets the check's mail, and the check reads the report. Kept apart from
   both so neither imports the other. In memory on purpose: a check lives
   for two minutes inside one server process, and only that process waits
   for its answer.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ReplyCheckNote {
  accountId: string;
  /** reply: an answer to the check; original: the check email itself
   *  arriving; bounced / auto_reply: something that is not an answer. */
  kind: 'reply' | 'original' | 'bounced' | 'auto_reply';
  matched?: boolean;
  stopped?: boolean;
  at?: number;
}

const notes = new Map<string, ReplyCheckNote[]>();

export function noteReplyCheck(token: string, note: ReplyCheckNote): void {
  const list = notes.get(token) || [];
  list.push({ ...note, at: Date.now() });
  notes.set(token, list);
  // Nothing should outlive its check by long; keep the map small regardless.
  if (notes.size > 200) {
    const oldest = [...notes.keys()].slice(0, notes.size - 200);
    for (const k of oldest) notes.delete(k);
  }
}

export function readReplyCheckNotes(token: string): ReplyCheckNote[] {
  return notes.get(token) || [];
}

export function forgetReplyCheck(token: string): void {
  notes.delete(token);
}
