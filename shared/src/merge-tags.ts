/* ═══════════════════════════════════════════════════════════════════════
   Merge tags.

   The old substitution was a chain of thirteen .replace() calls with no
   catch-all, which meant a tag it didn't recognise travelled all the way
   into the prospect's inbox with its braces intact. Worse, the preview
   path *did* strip unknown tags, so every test send looked perfect and
   only the real recipient ever saw `Idea to help Acme with {{pain_point}}`.
   Four of the thirteen it claimed to support — city, country and the two
   custom_field_N — read columns that do not exist on the contacts table,
   so they silently resolved to nothing every single time.

   This module replaces all of that with one pass that:
     · knows which tags exist, from the columns that are really there
     · supports `{{first_name | there}}` so a missing value has a word to
       fall back on instead of leaving "Hi ,"
     · blanks anything it does not recognise, so nothing raw can ship
     · can defer tags that a later stage owns (the unsubscribe link and
       the sender's details aren't known until a mailbox is chosen)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * `{{ tag }}` or `{{ tag | fallback }}`.
 *
 * The tag is letters, digits, underscore and dot (dot for `custom.region`).
 * The fallback runs to the closing brace, so it can contain spaces and
 * punctuation — `{{first_name | there}}`, `{{company | your team}}`.
 */
const TAG_PATTERN = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;

/** Tags whose value only exists once a sending mailbox has been picked. */
export const SENDER_TAGS = ['sender_name', 'sender_company', 'sender_email', 'sender_first_name'];

/** Resolved by the sender at send time against a tracking id. */
export const LINK_TAGS = ['unsubscribe_link'];

export interface SenderIdentity {
  /** The display name on the From header. */
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

export interface MergeContext {
  contact?: any;
  sender?: SenderIdentity | null;
  /**
   * Tags to leave exactly as they are, braces and all, because a later
   * stage owns them. Anything not deferred and not resolvable is blanked.
   */
  defer?: readonly string[];
}

/** "London, England, United Kingdom" → first segment. */
function cityFromLocation(location?: string | null): string {
  if (!location) return '';
  return location.split(',')[0]?.trim() || '';
}

/** "London, England, United Kingdom" → last segment, when there is one. */
function countryFromLocation(location?: string | null): string {
  if (!location) return '';
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/**
 * Every tag this platform can fill, and where its value comes from.
 *
 * Exported so the campaign editor and the pre-launch audit describe exactly
 * the same set the sender does — a tag that autocompletes but doesn't send
 * is the bug this module exists to prevent.
 */
export function buildTagValues(ctx: MergeContext): Record<string, string> {
  const c = ctx.contact || {};
  const first = str(c.first_name);
  const last = str(c.last_name);
  const sender = ctx.sender || {};
  const senderName = str(sender.name);

  const values: Record<string, string> = {
    // ─── Contact ───
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(' '),
    email: str(c.email),
    company: str(c.company),
    job_title: str(c.job_title),
    phone: str(c.phone),
    linkedin_url: str(c.linkedin_url),
    website: str(c.website),
    location: str(c.location),
    city: cityFromLocation(c.location),
    country: countryFromLocation(c.location),

    // ─── Sender ───
    sender_name: senderName,
    sender_first_name: senderName.split(/\s+/)[0] || '',
    sender_email: str(sender.email),
    sender_company: str(sender.company),
  };

  // Custom fields are a jsonb map keyed by whatever the CSV column was
  // called, so they can't be enumerated up front. Expose each by its own
  // name and under `custom.<name>`, and keep custom_field_1 / _2 working
  // as positional access for anyone whose templates already use them.
  const custom = c.custom_fields;
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    const entries = Object.entries(custom as Record<string, unknown>);
    for (const [key, value] of entries) {
      const v = str(value);
      const safe = key.trim().replace(/\s+/g, '_').toLowerCase();
      if (!safe) continue;
      // First field wins when two distinct CSV columns normalise to the same
      // name (e.g. "Region" and "REGION") — applied consistently to both the
      // bare and `custom.`-prefixed forms so {{region}} and {{custom.region}}
      // never disagree about which value they mean.
      if (!(`custom.${safe}` in values)) values[`custom.${safe}`] = v;
      // Never let a custom field shadow a built-in — a column called
      // "company" in someone's CSV must not override the real one.
      if (!(safe in values)) values[safe] = v;
    }
    entries.forEach(([, value], i) => {
      values[`custom_field_${i + 1}`] = str(value);
    });
  }

  return values;
}

/**
 * Fill every merge tag in `text`.
 *
 * A tag with a value gets it. A tag without one falls back to the text
 * after the pipe, or to nothing. A tag nobody recognises is removed
 * rather than shipped — the whole point of the exercise.
 */
export function renderMergeTags(text: string, ctx: MergeContext): string {
  if (!text) return '';
  const values = buildTagValues(ctx);
  const defer = new Set((ctx.defer || []).map((t) => t.toLowerCase()));

  return text.replace(TAG_PATTERN, (whole, rawName: string, rawFallback?: string) => {
    const name = rawName.toLowerCase();
    if (defer.has(name)) return whole;
    const value = values[name];
    if (value) return value;
    return rawFallback !== undefined ? rawFallback.trim() : '';
  });
}

/**
 * The tags a piece of copy actually uses, lowercased and de-duplicated.
 * Tags carrying a fallback are reported separately: they degrade
 * gracefully, so a gap in the data for one isn't worth warning about.
 */
export function extractTags(text: string): { name: string; hasFallback: boolean }[] {
  if (!text) return [];
  const seen = new Map<string, boolean>();
  for (const m of text.matchAll(TAG_PATTERN)) {
    const name = m[1].toLowerCase();
    const hasFallback = m[2] !== undefined;
    // If the same tag appears both with and without a fallback, the
    // bare one is the one that can leave a hole.
    seen.set(name, (seen.get(name) ?? true) && hasFallback);
  }
  return [...seen].map(([name, hasFallback]) => ({ name, hasFallback }));
}

/* ═══════════════════════════════════════════════════════════════════════
   Spintax.

   Eight hundred byte-identical bodies leaving a warmed pool of mailboxes
   is the exact shape filters look for, and it quietly undoes the work the
   sharding engine is doing to spread reputation around. `{Hi|Hey|Hello}`
   lets one template leave as many.

   The choice is deterministic, seeded by the recipient: the same contact
   always gets the same wording. That matters more than it sounds. Follow-up
   steps quote the first email, previews have to match what was sent, and a
   resend after a transient SMTP failure must not arrive rephrased.
   ═══════════════════════════════════════════════════════════════════════ */

/** Innermost `{a|b|c}` — no nested braces, so nesting resolves inside-out. */
const SPIN_PATTERN = /\{([^{}]*\|[^{}]*)\}/;

/** FNV-1a. Small, stable, and not trying to be a hash function for security. */
function seedFrom(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Avalanche the bits before anyone takes a modulus of them.
 *
 * Multiplying by an odd constant leaves the low bit exactly as it was, so a
 * plain FNV round feeding `% 2` returns the same answer forever: every
 * two-option group in a message picked the same branch, and `{a|b} {a|b}`
 * could only ever produce "a a" or "b b". This mixes the high bits down
 * (the murmur3 finaliser) so the low bits actually move.
 */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0xd35a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Pick one option from every `{a|b|c}` group in `text`.
 *
 * Nested groups work — `{Hi|{Hey|Hello}} there` — because the innermost
 * group always matches first and collapses before its parent is considered.
 *
 * A merge tag is never mistaken for spintax: `{{first_name}}` has no pipe
 * inside a single brace pair, and a fallback like `{{company|your team}}`
 * is double-braced, so the inner `{company|your team}` would match — which
 * is why spintax must run *after* merge tags are resolved. Callers get that
 * ordering for free through `personalize()`.
 */
export function spin(text: string, seed: string): string {
  if (!text || !text.includes('|')) return text || '';

  let out = text;
  let salt = seedFrom(seed);
  // Bounded: each pass removes one group, and a template with more than a
  // few hundred is a runaway, not a legitimate one.
  for (let guard = 0; guard < 500; guard++) {
    const match = SPIN_PATTERN.exec(out);
    if (!match) break;
    const options = match[1].split('|');
    // Re-seed per group so `{a|b} {a|b}` can differ, while staying a pure
    // function of the recipient — same contact, same message, every time.
    salt = mix(salt ^ (match.index + 0x9e3779b9));
    const choice = options[salt % options.length] ?? '';
    out = out.slice(0, match.index) + choice + out.slice(match.index + match[0].length);
  }
  return out;
}

/** Every wording a template can produce, for the editor's variation count. */
export function countSpinVariants(text: string): number {
  if (!text) return 1;
  let total = 1;
  let out = text;
  for (let guard = 0; guard < 500; guard++) {
    const match = SPIN_PATTERN.exec(out);
    if (!match) break;
    total *= match[1].split('|').length;
    if (total > 1e6) return 1e6;
    out = out.slice(0, match.index) + match[1].split('|')[0] + out.slice(match.index + match[0].length);
  }
  return total;
}

/**
 * The whole pipeline, in the only order that works: merge tags first so a
 * `{{company|your team}}` fallback is already gone by the time spintax
 * looks for single-brace groups, then one wording chosen for this recipient.
 */
export function personalize(text: string, ctx: MergeContext & { spinSeed?: string }): string {
  const filled = renderMergeTags(text, ctx);
  return ctx.spinSeed ? spin(filled, ctx.spinSeed) : filled;
}

/* ═══════════════════════════════════════════════════════════════════════
   Preview.

   There used to be three renderers: this one, the sender's, and a third in
   the campaign editor with its own sample names and its own idea of what a
   tag meant. They disagreed, which is how `{{pain_point}}` reached real
   inboxes while every preview looked perfect. One renderer, one sample,
   one answer — that is the entire point of this living in `shared`.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A believable contact for previews and test sends, shaped exactly like a
 * real contacts row — `location` rather than the city/country columns that
 * never existed, `custom_fields` as the jsonb map it really is. A preview
 * built on fields the database doesn't have agrees with nothing.
 */
export const SAMPLE_PREVIEW_CONTACT = {
  first_name: 'Alex',
  last_name: 'Morgan',
  email: 'alex.morgan@example.com',
  company: 'Acme Inc',
  job_title: 'Head of Growth',
  phone: '+1 (555) 123-4567',
  location: 'San Francisco, California, United States',
  linkedin_url: 'https://linkedin.com/in/alexmorgan',
  website: 'https://acme.example.com',
  custom_fields: { custom_field_1: 'Sample 1', custom_field_2: 'Sample 2' },
};

export const SAMPLE_PREVIEW_SENDER: SenderIdentity = {
  name: 'Jordan Lee',
  email: 'jordan@yourcompany.com',
  company: 'Your Company',
};

/**
 * Render copy the way a recipient will actually receive it.
 *
 * `spinSeed` is exposed so the editor can offer "show me another variation"
 * — every seed is a wording some real contact will get.
 */
export function previewPersonalization(
  text: string,
  opts?: { sender?: SenderIdentity | null; spinSeed?: string },
): string {
  return personalize(text || '', {
    contact: SAMPLE_PREVIEW_CONTACT,
    sender: opts?.sender ?? SAMPLE_PREVIEW_SENDER,
    spinSeed: opts?.spinSeed ?? 'preview',
  }).replace(/\{\{\s*unsubscribe_link\s*\}\}/gi, 'https://example.com/unsubscribe/preview');
}

/** Human labels for the audit and the editor's tag menu. */
export const TAG_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name',
  email: 'Email',
  company: 'Company',
  job_title: 'Job title',
  phone: 'Phone',
  linkedin_url: 'LinkedIn URL',
  website: 'Website',
  location: 'Location',
  city: 'City',
  country: 'Country',
  sender_name: 'Your name',
  sender_first_name: 'Your first name',
  sender_email: 'Your email',
  sender_company: 'Your company',
  unsubscribe_link: 'Unsubscribe link',
};

/** Contact fields a tag reads, for the pre-launch coverage audit. */
export const TAG_SOURCE_FIELD: Record<string, string> = {
  first_name: 'first_name',
  last_name: 'last_name',
  full_name: 'first_name',
  email: 'email',
  company: 'company',
  job_title: 'job_title',
  phone: 'phone',
  linkedin_url: 'linkedin_url',
  website: 'website',
  location: 'location',
  city: 'location',
  country: 'location',
};
