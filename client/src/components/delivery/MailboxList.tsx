import { cn } from '../../lib/utils';
import { AlertTriangle, Check, ChevronRight } from 'lucide-react';
import type { SmtpAccount, InboxSyncProgress } from '@lemlist/shared';
import {
  resolveMailboxState, mailboxScore, formatDailyLimit, warmupAllowance,
  detectPresetFromEmail, SMTP_PRESETS,
} from '@lemlist/shared';
import { ProviderLogo } from '../mailbox/ProviderLogo';

/** Which provider a saved mailbox is, from its address or its server. */
function providerOf(a: SmtpAccount): string | null {
  return detectPresetFromEmail(a.email_address)?.name
    ?? SMTP_PRESETS.find((p) => p.smtp_host && p.smtp_host === a.smtp_host)?.name
    ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════
   The mailbox list.

   What this replaces was a seven-column table needing 880px and a
   horizontal scrollbar to show three mailboxes, in which every cell was a
   rounded pill: Authenticated, Verified, Warming, 100%, 0/15. Six status
   signals per row, and between them they never said whether the mailbox
   worked - three of them sat green while none could receive a reply.

   Three decisions, in order of how much they matter.

   ONE STATUS. resolveMailboxState picks the single thing worth saying,
   ordered by what stops you first. A list where every row says one thing
   can be scanned. A row saying five things has to be read.

   COLOUR ONLY FOR DEVIATION. Pills are for exceptions. When every cell is
   a pill nothing reads as notable, which is precisely how a broken mailbox
   went unnoticed behind three green badges. Working mailboxes are quiet
   here; the eye is meant to land on the one that is not.

   SETTINGS BEHIND THE ROW. The history window, the daily cap, the servers
   belong to a mailbox, so they live inside it - the row opens the
   mailbox's own panel (MailboxDrawer) rather than a preference taking the
   most valuable space on the page.
   ═══════════════════════════════════════════════════════════════════════ */

const TONE = {
  broken: {
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    row: 'bg-rose-500/[0.03]',
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    row: '',
  },
  ready: {
    dot: 'bg-emerald-500',
    text: 'text-[var(--text-tertiary)]',
    row: '',
  },
  idle: {
    dot: 'bg-[var(--border-strong)]',
    text: 'text-[var(--text-tertiary)]',
    row: '',
  },
} as const;

export interface MailboxListProps {
  accounts: SmtpAccount[];
  progress: InboxSyncProgress[];
  domainVerified: (email: string) => boolean;
  domainKnown: (email: string) => boolean;
  /** Open the mailbox's detail panel. */
  onOpen: (a: SmtpAccount) => void;
  onEdit: (a: SmtpAccount) => void;
  onTest: (a: SmtpAccount) => void;
  onRepair: () => void;
  onAuthenticateDomain: (a: SmtpAccount) => void;
  testingId: string | null;
  repairing: boolean;
}

function Row({
  account, progress, domainVerified, domainKnown,
  onOpen, onEdit, onTest, onRepair, onAuthenticateDomain,
  testing, repairing,
}: {
  account: SmtpAccount;
  progress?: InboxSyncProgress;
  domainVerified: boolean;
  domainKnown: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onTest: () => void;
  onRepair: () => void;
  onAuthenticateDomain: () => void;
  testing: boolean;
  repairing: boolean;
}) {

  const state = resolveMailboxState({
    is_active: account.is_active,
    is_verified: account.is_verified,
    imap_host: account.imap_host,
    sync_error: progress?.last_error ?? null,
    domain_verified: domainVerified,
    domain_known: domainKnown,
    warmup_mode: account.warmup_mode,
  });

  const tone = TONE[state.tone];
  const score = mailboxScore(account);
  const limit = warmupAllowance(account);
  const name = account.from_name || account.label;

  /*
   * The remedy is the state's, not the row's. A row that offers every
   * button for every situation is a row that has not decided anything -
   * and deciding is the entire job of the status above it.
   */
  const remedy = state.action === 'fix-connection'
    ? { label: repairing ? 'Fixing…' : 'Fix this for me', run: onRepair, disabled: repairing }
    /*
     * No incoming server is not something the repair can guess - it
     * corrects hosts that do not exist, it cannot invent one that was never
     * set. The settings form opens straight onto the empty field.
     */
    : state.action === 'set-imap'
      ? { label: 'Add incoming server', run: onEdit, disabled: false }
    : state.action === 'authenticate-domain'
      ? { label: domainKnown ? 'Finish DNS setup' : 'Add this domain', run: onAuthenticateDomain, disabled: false }
      : state.action === 'verify'
        ? { label: testing ? 'Testing…' : 'Test it now', run: onTest, disabled: testing }
        : null;

  return (
    <li className={cn('border-b border-[var(--border-subtle)] last:border-0', tone.row)}>
      {/* The row proper. One line of identity, one line of status. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={cn('h-2 w-2 flex-shrink-0 rounded-full', tone.dot)}
          aria-hidden
        />

        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          title="Open this mailbox"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <ProviderLogo name={providerOf(account)} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-strong font-medium text-[var(--text-primary)]">
                {account.email_address}
              </span>
              {name && name !== account.email_address && (
                <span className="hidden truncate text-body text-[var(--text-tertiary)] sm:inline">
                  {name}
                </span>
              )}
            </span>
            <span className={cn('mt-0.5 block truncate text-body', tone.text)}>
              <span className="font-medium">{state.label}</span>
              {state.detail && <span className="text-[var(--text-tertiary)]"> — {state.detail}</span>}
            </span>
          </span>

          {/*
            * Numbers sit right-aligned and quiet. They are reference, not
            * status - and the score is absent entirely until the mailbox
            * has sent something, because a percentage computed from no
            * sends is not a measurement.
            */}
          <span className="hidden flex-shrink-0 items-center gap-5 text-right sm:flex">
            <span className="w-16">
              <span className="block text-body tabular text-[var(--text-secondary)]">
                {account.sends_today}<span className="text-[var(--text-muted)]">/{formatDailyLimit(limit)}</span>
              </span>
              <span className="block text-micro text-[var(--text-muted)]">today</span>
            </span>
            <span className="w-14">
              {score === null ? (
                <span className="block text-body text-[var(--text-muted)]">—</span>
              ) : (
                <span className={cn(
                  'block text-body tabular font-medium',
                  score >= 80 ? 'text-[var(--text-secondary)]' : 'text-amber-600 dark:text-amber-400',
                )}>{score}%</span>
              )}
              <span className="block text-micro text-[var(--text-muted)]">health</span>
            </span>
          </span>

          <ChevronRight className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
        </button>

        {/*
          * One button, always visible, always labelled. The old row hid
          * three unlabelled 28px icons behind a hover, which is unusable on
          * a touchscreen and invisible to anyone scanning.
          */}
        {remedy && (
          <button
            type="button"
            onClick={remedy.run}
            disabled={remedy.disabled}
            className="h-7 flex-shrink-0 rounded-md bg-[var(--indigo)] px-2.5 text-caption font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            data-remedy
          >
            {remedy.label}
          </button>
        )}
      </div>

    </li>
  );
}

export function MailboxList(props: MailboxListProps) {
  const {
    accounts, progress, domainVerified, domainKnown,
    onOpen, onEdit, onTest, onRepair, onAuthenticateDomain,
    testingId, repairing,
  } = props;

  const byId = new Map(progress.map((p) => [p.smtp_account_id, p]));

  /*
   * Broken first, then warnings, then the quiet ones.
   *
   * A list ordered by creation date buries the one row that needs a person
   * underneath the ones that do not. Within a tone the original order is
   * kept, so nothing jumps about as states change.
   */
  const rank: Record<string, number> = { broken: 0, warning: 1, ready: 2, idle: 3 };
  const sorted = [...accounts].sort((a, b) => {
    const sa = resolveMailboxState({
      is_active: a.is_active, is_verified: a.is_verified, imap_host: a.imap_host,
      sync_error: byId.get(a.id)?.last_error ?? null,
      domain_verified: domainVerified(a.email_address),
      domain_known: domainKnown(a.email_address),
      warmup_mode: a.warmup_mode,
    });
    const sb = resolveMailboxState({
      is_active: b.is_active, is_verified: b.is_verified, imap_host: b.imap_host,
      sync_error: byId.get(b.id)?.last_error ?? null,
      domain_verified: domainVerified(b.email_address),
      domain_known: domainKnown(b.email_address),
      warmup_mode: b.warmup_mode,
    });
    return rank[sa.tone] - rank[sb.tone];
  });

  const needsAttention = sorted.filter((a) => {
    const s = resolveMailboxState({
      is_active: a.is_active, is_verified: a.is_verified, imap_host: a.imap_host,
      sync_error: byId.get(a.id)?.last_error ?? null,
      domain_verified: domainVerified(a.email_address),
      domain_known: domainKnown(a.email_address),
      warmup_mode: a.warmup_mode,
    });
    return s.tone === 'broken' || s.tone === 'warning';
  }).length;

  return (
    <div className="panel overflow-hidden">
      {/*
        * A summary line, not a dashboard. One sentence saying whether
        * anything wants you, replacing a setup-progress card, an at-risk
        * banner and a header strip that between them said less.
        */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        {needsAttention === 0 ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
            <p className="text-body text-[var(--text-secondary)]">
              All {accounts.length} mailbox{accounts.length === 1 ? '' : 'es'} are sending and receiving.
            </p>
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <p className="text-body text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">{needsAttention}</span> of{' '}
              {accounts.length} need{needsAttention === 1 ? 's' : ''} attention.
            </p>
          </>
        )}
      </div>

      <ul>
        {sorted.map((account) => (
          <Row
            key={account.id}
            account={account}
            progress={byId.get(account.id)}
            domainVerified={domainVerified(account.email_address)}
            domainKnown={domainKnown(account.email_address)}
            onOpen={() => onOpen(account)}
            onEdit={() => onEdit(account)}
            onTest={() => onTest(account)}
            onRepair={onRepair}
            onAuthenticateDomain={() => onAuthenticateDomain(account)}
            testing={testingId === account.id}
            repairing={repairing}
          />
        ))}
      </ul>
    </div>
  );
}
