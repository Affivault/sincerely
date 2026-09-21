/* ═══════════════════════════════════════════════════════════════════════
   Moved to @lemlist/shared, so the client refuses to draw a conclusion
   for the same reasons the server refuses to compute one.

   Re-exported rather than copied: two implementations of a confidence
   bound agree right up until one of them is tuned, which is the trap
   that two copies of imapHostFor set and eventually sprung.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  normalCdf,
  twoProportionPValue,
  wilsonLowerBound,
  wilsonUpperBound,
} from '@lemlist/shared';
