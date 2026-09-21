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
