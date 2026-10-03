/* ═══════════════════════════════════════════════════════════════════════
   Does this email read like spam to a filter?

   The launch review checked everything about the sender - domain, mailbox,
   warm-up, bounce rate - and nothing about what was being sent. Filters
   read both. This reads the emails the way they do, for the handful of
   things that reliably cost inbox placement in cold email:

     phrases     the classic triggers ("act now", "click here", "100% free")
     subject     shouting (ALL CAPS, "!"), or a fake "Re:"/"Fwd:" on a
                 first email - providers treat that as deception
     links       too many; a link shortener (the strongest single signal);
                 links to a domain other than the one sending
     images      an image-heavy email with little text, or any image in a
                 first email

   Each finding says where it is and why it matters, and the phrases that
   have a plain alternative carry one, which the launch review can apply
   in one click. Merge tags and links are never rewritten.

   Warnings, never a block: copy is the sender's call.

   Pure: the steps in, findings out.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ContentStep {
  id?: string;
  step_order: number;
  step_type?: string;
  subject?: string | null;
  body_html?: string | null;
  body_text?: string | null;
}

export interface ContentIssue {
  code: 'phrase' | 'subject_caps' | 'subject_bang' | 'fake_reply' | 'links' | 'shortener' | 'link_domain' | 'image_heavy' | 'image_first';
  /** Which email, 1-based as people count them; null for the whole sequence. */
  email: number | null;
  message: string;
  /** A plain-words alternative the review can apply. */
  replace?: { from: string; to: string };
}

/** Trigger phrases, and a plain alternative where one reads naturally. */
const PHRASES: Array<{ re: RegExp; label: string; to?: string }> = [
  { re: /\bact now\b/gi, label: 'act now', to: 'when you have a moment' },
  { re: /\bclick here\b/gi, label: 'click here', to: 'have a look' },
  { re: /\bbuy now\b/gi, label: 'buy now', to: 'take a look' },
  { re: /\border now\b/gi, label: 'order now', to: 'take a look' },
  { re: /\bapply now\b/gi, label: 'apply now', to: 'apply' },
  { re: /\bcall now\b/gi, label: 'call now', to: 'give me a call' },
  { re: /\brisk[- ]free\b/gi, label: 'risk-free', to: 'low-risk' },
  { re: /\bno obligation\b/gi, label: 'no obligation', to: 'no pressure' },
  { re: /\blimited[- ]time (?:offer|only)\b/gi, label: 'limited time offer', to: 'for now' },
  { re: /\bdear friend\b/gi, label: 'dear friend', to: 'Hi {{first_name|there}}' },
  { re: /\bspecial promotion\b/gi, label: 'special promotion', to: 'offer' },
  { re: /\bexclusive deal\b/gi, label: 'exclusive deal', to: 'offer' },
  { re: /\bonce in a lifetime\b/gi, label: 'once in a lifetime' },
  { re: /\b100% (?:free|guaranteed|satisfied)\b/gi, label: '100% free / guaranteed' },
  { re: /\bfree gift\b/gi, label: 'free gift' },
  { re: /\bguaranteed\b/gi, label: 'guaranteed' },
  { re: /\b(?:earn|make) (?:extra )?(?:money|cash)\b/gi, label: 'make money' },
  { re: /\bdouble your\b/gi, label: 'double your' },
  { re: /\bcash bonus\b/gi, label: 'cash bonus' },
  { re: /\blowest price\b/gi, label: 'lowest price' },
  { re: /\bwinner\b|\bcongratulations\b/gi, label: 'winner / congratulations' },
  { re: /\bthis is not spam\b/gi, label: 'this is not spam' },
  { re: /\$\$+|!!+/g, label: '"$$$" or "!!!"' },
];

const SHORTENERS = /^(?:bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|rb\.gy|s\.id|bl\.ink|t\.ly|lnkd\.in)$/i;
const MAX_LINKS = 3;

function textOf(step: ContentStep): string {
  const html = step.body_html || '';
  const fromHtml = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return (html ? fromHtml : step.body_text || '').replace(/[ \t]+/g, ' ').trim();
}

/** Visible words only: merge tags are filled in per person and never judged. */
function words(text: string): string {
  return text.replace(/\{\{[^}]*\}\}/g, ' ');
}

function links(step: ContentStep): string[] {
  const out = new Set<string>();
  const src = `${step.body_html || ''} ${step.body_text || ''}`;
  for (const m of src.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) out.add(m[0].replace(/[.,;]+$/, ''));
  return [...out];
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** The registrable part, near enough: the last two labels (three for co.uk-style). */
function baseDomain(host: string): string {
  const parts = host.split('.');
  const tail = parts.slice(-2).join('.');
  return /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(tail) ? parts.slice(-3).join('.') : tail;
}

export function checkEmailContent(steps: ContentStep[], opts: { sendingDomains?: string[]; trackingDomain?: string | null } = {}): ContentIssue[] {
  const emails = steps
    .filter((s) => (s.step_type || 'email') === 'email')
    .sort((a, b) => a.step_order - b.step_order);
  const ours = new Set([
    ...(opts.sendingDomains || []).map((d) => baseDomain(d.toLowerCase())),
    ...(opts.trackingDomain ? [baseDomain(opts.trackingDomain.toLowerCase())] : []),
  ]);
  const issues: ContentIssue[] = [];
  const phraseSeen = new Set<string>();

  emails.forEach((s, i) => {
    const n = i + 1;
    const subject = words(s.subject || '');
    const body = textOf(s);
    const visible = words(`${subject}\n${body}`);

    for (const p of PHRASES) {
      p.re.lastIndex = 0;
      const m = p.re.exec(visible);
      if (!m) continue;
      const key = `${p.label}|${n}`;
      if (phraseSeen.has(key)) continue;
      phraseSeen.add(key);
      issues.push({
        code: 'phrase', email: n,
        message: `"${m[0]}" is a common spam-filter trigger${p.to ? ` - "${p.to}" says the same` : ''}.`,
        ...(p.to ? { replace: { from: m[0], to: p.to } } : {}),
      });
    }

    if (i === 0 && /^\s*(re|fwd?|fw)\s*:/i.test(s.subject || '')) {
      issues.push({ code: 'fake_reply', email: n, message: 'The first email\'s subject starts with "Re:" or "Fwd:" when nothing came before it. Providers treat that as deception.' });
    }
    const shouty = (subject.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !/^(HTML|HTTP|HTTPS|SaaS|CEO|CFO|CTO|COO|CMO|ISA|SIPP|USA|UK|EU|API|CRM|SEO|B2B|B2C|ROI|KPI|FAQ)$/.test(w));
    if (shouty.length >= 2) issues.push({ code: 'subject_caps', email: n, message: `The subject shouts (${shouty.slice(0, 3).join(', ')}). Capitals in a subject read as marketing.` });
    if (/!/.test(subject)) issues.push({ code: 'subject_bang', email: n, message: 'An exclamation mark in the subject. A person writing to one person rarely uses one.' });

    const ls = links(s);
    if (ls.length > MAX_LINKS) issues.push({ code: 'links', email: n, message: `${ls.length} links. More than ${MAX_LINKS} in a cold email is one of the strongest spam signals; one is plenty.` });
    const short = ls.map(hostOf).filter((h): h is string => !!h && SHORTENERS.test(h));
    if (short.length) issues.push({ code: 'shortener', email: n, message: `A link shortener (${short[0]}). Spammers use them to hide where a link goes, so filters treat them harshly. Link to the real address.` });
    if (ours.size) {
      const foreign = [...new Set(ls.map(hostOf).filter((h): h is string => !!h && !SHORTENERS.test(h) && !ours.has(baseDomain(h))))];
      if (foreign.length) issues.push({ code: 'link_domain', email: n, message: `Links to ${foreign.slice(0, 2).join(' and ')}${foreign.length > 2 ? ' and more' : ''}, which is not the domain you send from. Filters weigh a mismatch; fine if it is your own site, worth knowing if not.` });
    }

    const images = ((s.body_html || '').match(/<img\b/gi) || []).length;
    if (images > 0 && body.replace(/\s+/g, ' ').length < 300) {
      issues.push({ code: 'image_heavy', email: n, message: 'Mostly image, little text. Filters cannot read an image and assume the worst.' });
    } else if (images > 0 && i === 0) {
      issues.push({ code: 'image_first', email: n, message: 'An image in the first email. A plain first email lands in the inbox more often; save images for later, if at all.' });
    }
  });
  return issues;
}

/** Apply the suggested rewrites to one step's text. Merge tags and links are left alone. */
export function applyContentFixes<T extends { subject?: string | null; body_html?: string | null; body_text?: string | null }>(step: T, fixes: Array<{ from: string; to: string }>): T {
  const swap = (value: string | null | undefined): string | null | undefined => {
    if (!value) return value;
    let out = value;
    for (const f of fixes) {
      const re = new RegExp(`(?<![\\w{/.-])${f.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w}])`, 'gi');
      out = out.replace(re, (hit) => (hit[0] === hit[0].toUpperCase() && hit[0] !== hit[0].toLowerCase()
        ? f.to.charAt(0).toUpperCase() + f.to.slice(1)
        : f.to));
    }
    return out;
  };
  return { ...step, subject: swap(step.subject), body_html: swap(step.body_html), body_text: swap(step.body_text) };
}
