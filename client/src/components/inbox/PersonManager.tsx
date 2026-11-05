import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft, Ban, ListPlus, Loader2, Megaphone, Play, UserPlus, Users, X, ArrowUpRight,
} from 'lucide-react';
import type { ContactCampaignMembership, Lifecycle } from '@lemlist/shared';
import { contactsApi, listsApi } from '../../api/contacts.api';
import { campaignsApi } from '../../api/campaigns.api';
import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Managing the person from the conversation with them.

   Everything you would otherwise open their record for: whether they are a
   lead or a contact, which campaigns are still writing to them (and a way
   to stop one of them, for this person only), and which lists they sit on.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The contact a thread is about. The message carries it when inbox sync
 * matched one; when it did not, the address may still belong to somebody
 * in the CRM, so it is looked up once rather than offering to create a
 * duplicate of a person who already exists.
 */
export function useThreadContactId(contactId: string | null | undefined, email: string | null | undefined) {
  const addr = (email || '').trim().toLowerCase();
  const { data: found, isLoading } = useQuery({
    queryKey: ['contacts', 'by-email', addr],
    queryFn: async () => {
      const r = await contactsApi.list({ search: addr, limit: 5, lifecycle: 'all' });
      return (r.data || []).find((c) => (c.email || '').toLowerCase() === addr)?.id ?? null;
    },
    enabled: !contactId && !!addr,
    staleTime: 60_000,
  });
  return { id: contactId || found || null, resolving: !contactId && !!addr && isLoading };
}

/** Lead/contact names a person by where they live in the app. */
export const contactHref = (id: string) => `/contacts/${id}`;

const ROW_BTN = 'inline-flex items-center gap-1 h-7 px-2 rounded-md text-caption font-semibold transition-colors disabled:opacity-40';

const LIVE: ContactCampaignMembership['status'][] = ['pending', 'active'] as any;

const ENROL_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Queued', tone: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]' },
  active: { label: 'Sending', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  paused: { label: 'Stopped', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  replied: { label: 'Replied', tone: 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' },
  completed: { label: 'Finished', tone: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' },
  auto_reply: { label: 'Auto-reply', tone: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' },
  bounced: { label: 'Bounced', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  unsubscribed: { label: 'Unsubscribed', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  suppressed: { label: 'Suppressed', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  error: { label: 'Error', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
};

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { first_name: parts[0] || undefined, last_name: parts.slice(1).join(' ') || undefined };
}

/** For a thread whose sender is nobody in the CRM yet. */
export function SavePerson({ email, name, company }: { email: string; name?: string | null; company?: string | null }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (lifecycle: 'prospect' | 'contact') => contactsApi.create({
      email,
      ...(name && !name.includes('@') ? splitName(name) : {}),
      company: company || undefined,
      lifecycle,
    }),
    onSuccess: (_c, lifecycle) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(lifecycle === 'prospect' ? 'Saved as a lead' : 'Saved as a contact');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save them'),
  });
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-default)] p-3">
      <p className="text-body font-semibold text-[var(--text-primary)]">Not in your CRM yet</p>
      <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">Save them to open their page, add them to lists and campaigns.</p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => save.mutate('prospect')}
          disabled={save.isPending}
          className="inline-flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[var(--indigo)] text-caption font-semibold text-white hover:bg-[var(--indigo-hover)] disabled:opacity-50 transition-colors"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Save as lead
        </button>
        <button
          onClick={() => save.mutate('contact')}
          disabled={save.isPending}
          className="inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[var(--border-default)] text-caption font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
        >
          <Users className="h-3.5 w-3.5" /> Save as contact
        </button>
      </div>
    </div>
  );
}

/** Lead or contact, and the switch between them. */
export function PersonStage({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const { data: contact } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => contactsApi.get(contactId),
  });
  const stage = ((contact?.lifecycle || 'prospect') as Lifecycle);
  const move = useMutation({
    mutationFn: (to: 'prospect' | 'contact') => contactsApi.setLifecycle([contactId], to),
    onSuccess: (_r, to) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['lists'] });
      toast.success(to === 'contact' ? 'Converted to a contact - now on the Contacts page' : 'Moved back to Leads');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move them'),
  });
  if (!contact) return <Skeleton className="h-9 w-full rounded-lg" />;

  const isLead = stage === 'prospect';
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-caption font-semibold',
        isLead ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : stage === 'customer' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
      )}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {isLead ? 'Lead' : stage === 'customer' ? 'Customer' : 'Contact'}
      </span>
      {stage !== 'customer' && (
        <button
          onClick={() => move.mutate(isLead ? 'contact' : 'prospect')}
          disabled={move.isPending}
          title={isLead ? 'Move them to Contacts, your CRM. Cold campaigns no longer reach them.' : 'Move them back to Leads, where cold campaigns can reach them.'}
          className={cn(ROW_BTN, 'ml-auto text-[var(--indigo-text)] hover:bg-[var(--indigo-subtle)]')}
        >
          {move.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
          {isLead ? 'Convert to contact' : 'Back to leads'}
        </button>
      )}
    </div>
  );
}

/**
 * The campaigns writing to this person, each with a stop that applies to
 * them alone: the campaign carries on for everyone else.
 */
export function PersonCampaigns({ contactId, firstName }: { contactId: string; firstName: string }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['contacts', contactId, 'campaigns'],
    queryFn: () => contactsApi.getCampaigns(contactId),
  });
  const [confirming, setConfirming] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contacts', contactId, 'campaigns'] });
    qc.invalidateQueries({ queryKey: ['campaigns'] });
  };
  const stop = useMutation({
    mutationFn: (m: ContactCampaignMembership) => campaignsApi.pauseContacts(m.campaign_id, [m.campaign_contact_id]),
    onSuccess: (r, m) => {
      setConfirming(null);
      refresh();
      if (r.paused > 0) toast.success(`Stopped for ${firstName} only. ${m.campaign_name || 'The campaign'} carries on for everyone else.`);
      else toast('Nothing left to stop - their sequence had already ended.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not stop that'),
  });
  const resume = useMutation({
    mutationFn: (m: ContactCampaignMembership) => campaignsApi.resumePaused(m.campaign_id, [m.campaign_contact_id]),
    onSuccess: () => { refresh(); toast.success(`${firstName} is back in the sequence`); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not resume that'),
  });

  if (isLoading) return <Skeleton className="h-12 w-full rounded-lg" />;
  if (rows.length === 0) return <p className="text-caption text-[var(--text-tertiary)]">Not in any campaign.</p>;

  // Live ones first: those are the ones you might want to stop.
  const ordered = [...rows].sort((a, b) => Number(LIVE.includes(b.status)) - Number(LIVE.includes(a.status)));

  return (
    <ul className="space-y-1.5">
      {ordered.map((m) => {
        const st = ENROL_LABEL[m.status] || { label: m.status, tone: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]' };
        const live = LIVE.includes(m.status) && m.is_active;
        const stopped = m.status === ('paused' as any);
        const busy = (stop.isPending && stop.variables?.campaign_contact_id === m.campaign_contact_id)
          || (resume.isPending && resume.variables?.campaign_contact_id === m.campaign_contact_id);
        return (
          <li key={m.campaign_contact_id} className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Megaphone className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
              <Link to={`/campaigns/${m.campaign_id}`} className="min-w-0 flex-1 truncate text-body font-medium text-[var(--text-primary)] hover:text-[var(--indigo-text)]" title={m.campaign_name || undefined}>
                {m.campaign_name || 'Untitled campaign'}
              </Link>
              <span className={cn('flex-shrink-0 inline-flex items-center h-5 px-1.5 rounded text-micro font-semibold', st.tone)}>{st.label}</span>
            </div>
            {(live || stopped) && (
              <div className="mt-1.5 flex items-center gap-2 pl-[22px]">
                <span className="text-micro text-[var(--text-tertiary)] tabular">Step {m.current_step_order + 1}</span>
                {confirming === m.campaign_contact_id ? (
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => stop.mutate(m)} disabled={busy} className={cn(ROW_BTN, 'bg-rose-600 text-white hover:bg-rose-700')}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />} Stop for {firstName}
                    </button>
                    <button aria-label="Cancel" onClick={() => setConfirming(null)} className="icon-btn h-7 w-7"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ) : live ? (
                  <button
                    onClick={() => setConfirming(m.campaign_contact_id)}
                    title={`Stop this campaign's emails to ${firstName} only. Everyone else keeps getting theirs.`}
                    className={cn(ROW_BTN, 'ml-auto text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400')}
                  >
                    <Ban className="h-3 w-3" /> Stop for them
                  </button>
                ) : (
                  <button onClick={() => resume.mutate(m)} disabled={busy} className={cn(ROW_BTN, 'ml-auto text-[var(--indigo-text)] hover:bg-[var(--indigo-subtle)]')}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Resume
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A native select laid invisibly over a small button: a real control for
 * the keyboard and screen readers, without a bespoke menu.
 */
function PickerButton({ label, icon, options, onPick, disabled, className, children }: {
  label: string;
  icon: React.ReactNode;
  options: { id: string; name: string }[];
  onPick: (id: string) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className={cn('relative cursor-pointer focus-within:shadow-[var(--ring-focus)]', ROW_BTN, disabled && 'opacity-40 pointer-events-none', className)} title={label}>
      {icon}{children}
      <select
        aria-label={label}
        value=""
        disabled={disabled || options.length === 0}
        onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer !min-h-0"
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

/** The lists they are on: move between them, take them off, add one. */
export function PersonLists({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const { data: lists = [], isLoading } = useQuery({
    queryKey: ['lists', 'contact', contactId],
    queryFn: () => listsApi.getListsForContact(contactId),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['contacts', contactId] });
  };
  const fail = (e: any) => toast.error(e?.response?.data?.error || 'Could not change their lists');
  const add = useMutation({
    mutationFn: (listId: string) => listsApi.addContacts(listId, [contactId]),
    onSuccess: (_r, listId) => { refresh(); toast.success(`Added to ${lists.find((l) => l.id === listId)?.name || 'the list'}`); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (listId: string) => listsApi.removeContacts(listId, [contactId]),
    onSuccess: (_r, listId) => { refresh(); toast.success(`Taken off ${lists.find((l) => l.id === listId)?.name || 'the list'}`); },
    onError: fail,
  });
  const move = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => listsApi.moveContact(contactId, from, to),
    onSuccess: (_r, v) => { refresh(); toast.success(`Moved to ${lists.find((l) => l.id === v.to)?.name || 'the list'}`); },
    onError: fail,
  });

  if (isLoading) return <Skeleton className="h-12 w-full rounded-lg" />;
  const members = lists.filter((l) => l.is_member);
  const others = lists.filter((l) => !l.is_member).map((l) => ({ id: l.id, name: `${l.name}${l.kind === 'contact' ? ' (contacts)' : ''}` }));
  const busy = add.isPending || remove.isPending || move.isPending;

  return (
    <div>
      {members.length === 0 ? (
        <p className="text-caption text-[var(--text-tertiary)]">On no lists.</p>
      ) : (
        <ul className="space-y-1">
          {members.map((l) => (
            <li key={l.id} className="group flex items-center gap-1.5 min-w-0 h-8 pl-2 pr-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: l.color || 'var(--text-tertiary)' }} />
              <Link to={`/${l.kind === 'contact' ? 'contacts' : 'leads'}?list=${l.id}`} className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)] hover:text-[var(--indigo-text)]">
                {l.name}
              </Link>
              <PickerButton
                label={`Move from ${l.name} to another list`}
                icon={<ArrowRightLeft className="h-3 w-3" />}
                options={others}
                disabled={busy}
                onPick={(to) => move.mutate({ from: l.id, to })}
                className="px-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)]"
              />
              <button
                aria-label={`Remove from ${l.name}`}
                title={`Remove from ${l.name}`}
                onClick={() => remove.mutate(l.id)}
                disabled={busy}
                className="icon-btn h-7 w-7 hover:!text-rose-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <PickerButton
          label="Add to a list"
          icon={busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
          options={others}
          disabled={busy}
          onPick={(id) => add.mutate(id)}
          className="mt-1.5 text-[var(--indigo-text)] hover:bg-[var(--indigo-subtle)]"
        >
          Add to list
        </PickerButton>
      )}
    </div>
  );
}

/** "Open full page" for a person, used where the name alone is not enough of a hint. */
export function OpenPersonLink({ contactId, className }: { contactId: string; className?: string }) {
  return (
    <Link to={contactHref(contactId)} className={cn('inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo-text)] hover:underline', className)}>
      Open full page <ArrowUpRight className="h-3 w-3" />
    </Link>
  );
}

