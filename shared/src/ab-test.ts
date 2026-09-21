/* ═══════════════════════════════════════════════════════════════════════
   Which half of a split test an email belongs to.

   The sender and the report disagreed about what an A/B test even is.

   Analytics counted a step as a test when it had EITHER a variant subject
   or a variant body - `.or('subject_b.not.is.null,body_html_b.not.is.null')`
   - which is right, because the builder offers the two independently, each
   with its own clear button. The sender stamped the variant onto the
   activity only when there was a variant SUBJECT.

   So a body-only test ran exactly as intended, varied the body exactly as
   intended, and recorded nothing. Every send went into the report with no
   variant on it, the reader defaulted a missing variant to 'a', and the
   panel showed variant A with all the volume beside variant B with none -
   over a test where half those sends were the B body. Not a gap in the
   data. A wrong answer, in the shape of a confident one, which somebody
   acts on by deleting the variant that was never measured.

   One predicate, used by both, so they cannot drift again.

   The assignment is here for a second reason. It used to be
   `contactId.charCodeAt(0) % 2`, which is an even split over a v4 UUID
   but is the SAME split in every test that contact is ever in: somebody
   who never opens anything sits in arm B of every experiment you run, for
   the life of the account. Over a few hundred contacts that is a bias
   pointing the same way every time. Mixing the step in costs nothing and
   makes each step its own independent draw.
   ═══════════════════════════════════════════════════════════════════════ */

export type AbVariant = 'a' | 'b';

export interface AbStep {
  subject_b?: string | null;
  body_html_b?: string | null;
}

/**
 * Is this step running a split test?
 *
 * Either field on its own is a test. The builder offers them separately,
 * so a body-only test is a perfectly ordinary thing to set up - and it was
 * the one that recorded nothing.
 */
export function stepHasVariantB(step: AbStep | null | undefined): boolean {
  if (!step) return false;
  return !!(step.subject_b || '').trim() || !!(step.body_html_b || '').trim();
}

/**
 * FNV-1a, 32-bit, finished with an avalanche step.
 *
 * The finaliser is not decoration, and leaving it off is a real bug that
 * the distribution test below caught before this shipped.
 *
 * FNV's round is `h ^= byte; h *= prime`. Every shift in that multiply is
 * by one or more places, so none of them can carry into bit 0 - which
 * means bit 0 of the finished hash is nothing but the XOR of bit 0 of
 * every input byte with bit 0 of the offset basis. It is a parity check,
 * not a hash. Two UUIDs differing in one character land in opposite
 * halves every single time, so `hash % 2` over `contact:step` flipped
 * EVERY contact's arm between one step and the next - the exact
 * correlation this function exists to remove, in a more systematic form
 * than the one-character split it replaced.
 *
 * fmix32 from MurmurHash3 spreads the high bits down, so the low bit
 * depends on the whole input.
 */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // The FNV prime, via shifts, so this stays in 32-bit integer maths
    // rather than losing precision to a float multiply.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // fmix32: the avalanche that makes every output bit depend on every
  // input bit. Math.imul keeps the multiplies in 32-bit.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Which arm this contact is in, for this step.
 *
 * Deterministic, so re-sending or re-processing the same step for the same
 * contact can never flip them into the other arm and corrupt the count.
 * Independent per step, so a contact is not pinned to one arm across every
 * test the account ever runs.
 */
export function assignVariant(contactId: string, stepId: string): AbVariant {
  return hash32(`${contactId}:${stepId}`) % 2 === 0 ? 'a' : 'b';
}

/**
 * The variant recorded on a sent activity, or null when it was not part of
 * an experiment.
 *
 * Null is the whole point. A send with no variant on it is one that
 * happened before the test was added to the step - it was never
 * randomised, and half of that group would have received B had the test
 * been running. Folding it into A does not merely add noise, it adds a
 * non-randomised group to one arm, which is the failure that invalidates
 * an experiment rather than just weakening it.
 *
 * The reader this replaces was `metadata?.ab_variant === 'b' ? 'b' : 'a'`,
 * which cannot return null and therefore counted every one of them as A.
 */
export function readVariant(metadata: unknown): AbVariant | null {
  const raw = (metadata as { ab_variant?: unknown } | null | undefined)?.ab_variant;
  if (raw === 'a' || raw === 'b') return raw;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
   Where a split test has got to, in one line.

   A test was invisible once you set it up. You added a variant subject in
   the builder, saved, and nothing anywhere said a test was running - no
   progress, no "not yet callable", no result. To learn any of it you had
   to know the A/B panel existed, find it under Analytics, and read a table.

   So people check on day one, see variant B four points ahead over
   eleven sends, and rewrite the sequence around noise. Or they never
   check at all, and the test runs for three months without ever being
   read.

   One line, resolved in one place, so the campaign page and the analytics
   panel cannot describe the same test differently.
   ═══════════════════════════════════════════════════════════════════════ */

export interface AbArm {
  sent: number;
  opened: number;
}

export interface AbStepOutcome {
  variant_a: AbArm;
  variant_b: AbArm;
  /** Set only when the gap is unlikely to be chance. */
  winner: AbVariant | null;
  /** Whichever is ahead, significant or not. */
  leading: AbVariant | null;
  has_enough_data: boolean;
  min_sample: number;
}

export type AbStatusTone = 'idle' | 'running' | 'ready';

export interface AbStatus {
  tone: AbStatusTone;
  /** Two or three words, for a chip beside the step. */
  short: string;
  /** One sentence, for a tooltip or a line under it. */
  detail: string;
  /** Sends in the smaller arm against what it needs. 0-100, or null when called. */
  percent: number | null;
}

/**
 * Resolve a step's test to the one thing worth saying about it.
 *
 * The smaller arm is what gates a verdict, so it is the one reported. An
 * average of the two would read as progress that is not there: 50 and 2 is
 * not "26 per variant", it is a test that cannot be called.
 */
export function abStatusLine(s: AbStepOutcome): AbStatus {
  const a = Math.max(0, s.variant_a?.sent || 0);
  const b = Math.max(0, s.variant_b?.sent || 0);
  const smaller = Math.min(a, b);
  const need = s.min_sample > 0 ? s.min_sample : 30;

  if (a + b === 0) {
    return {
      tone: 'idle',
      short: 'A/B ready',
      detail: 'Both versions are set. Nothing has gone out on this test yet.',
      percent: 0,
    };
  }

  /*
   * A winner is the only state worth acting on, so it is the only one
   * that reads as finished. `leading` deliberately does not.
   */
  if (s.winner) {
    return {
      tone: 'ready',
      short: `${s.winner.toUpperCase()} wins`,
      detail: `Variant ${s.winner.toUpperCase()} is ahead by more than chance explains. Worth rewriting the step around.`,
      percent: null,
    };
  }

  if (!s.has_enough_data || smaller < need) {
    /*
     * The number that stops you, and how far off it is. "Needs 30+" alone
     * gives no sense of whether that is tomorrow or next quarter.
     */
    return {
      tone: 'running',
      short: `A/B ${smaller}/${need}`,
      detail: smaller === 0
        ? `Only one version has gone out so far. Both need ${need} sends before this can be called.`
        : `${a} and ${b} sends so far. The smaller half needs ${need} before this can be called - anything read now is noise.`,
      percent: Math.min(100, Math.round((smaller / need) * 100)),
    };
  }

  return {
    tone: 'running',
    short: s.leading ? `${s.leading.toUpperCase()} ahead` : 'A/B level',
    detail: s.leading
      ? `Variant ${s.leading.toUpperCase()} is ahead, but the gap is still within chance. Leave it running.`
      : 'Both versions are performing identically so far.',
    percent: 100,
  };
}
