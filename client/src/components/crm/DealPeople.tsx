import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PARTICIPANT_ROLES } from '@lemlist/shared';
import type { Deal, DealParticipant } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { contactsApi } from '../../api/contacts.api';
import { Avatar } from '../shared/Avatar';
import { useConfirm } from '../ui/ConfirmDialog';
import { usePeek } from '../peek/usePeek';
import { cn } from '../../lib/utils';
import {
  Briefcase, Building2, Crown, Mail, Plus, Search, Star, Trash2, UserPlus, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Everybody on the deal.

   Deals are not sold to one person. There is somebody who wants it,
   somebody who signs it, somebody in security or procurement who can stop
   it, and somebody who has to use it afterwards. A pipeline that records
   one name per deal cannot answer either of the questions that decide
   whether it closes — is there a decision maker on this at all, and who is
   blocking it — and every email from the other four floats around the
   inbox unattached to the deal it is about.

   The primary contact keeps its place at the top, because there is always
   one person the deal is nominally with. Everyone else is a participant,
   with a role that says what they can do to the deal rather than what
   their job title is, since the two are frequently unrelated.
   ═══════════════════════════════════════════════════════════════════════ */

function fullName(c: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!c) return 'Unknown';
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return n || c.email || 'Unknown';
}

/** Roles that mean the deal can move, and roles that mean it might not. */
const ROLE_TONE: Record<string, string> = {
  'Decision maker': 'bg-[var(--indigo-subtle)] text-[var(--indigo)]',
  Champion: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Blocker: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

function RoleChip({ role }: { role: string }) {
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        ROLE_TONE[role] || 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
      )}
    >
      {role}
    </span>
  );
}

/* ── Adding somebody ──────────────────────────────────────────────────── */

function AddParticipant({
  dealId, excludeIds, onDone, onCancel,
}: {
  dealId: string;
  /** Contacts already on the deal — offering them again only invites a 409. */
  excludeIds: Set<string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['crm', 'participant-search', debounced],
    queryFn: () => contactsApi.list({ search: debounced, limit: 8 }),
    enabled: debounced.length >= 2,
  });

  const add = useMutation({
    mutationFn: (contactId: string) =>
      crmApi.addParticipant(dealId, { contact_id: contactId, role: role || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Added to the deal');
      onDone();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not add that person'),
  });

  const options = (results?.data || []).filter((c: any) => !excludeIds.has(c.id));

  return (
    <div className="rounded-lg border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)]/40 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
          placeholder="Search contacts by name or email…"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <button type="button" onClick={onCancel} className="icon-btn h-5 w-5" title="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {PARTICIPANT_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(role === r ? '' : r)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors',
              role === r
                ? 'bg-[var(--indigo)] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {debounced.length < 2 ? (
        <p className="px-1 py-1 text-[11px] text-[var(--text-muted)]">
          Type at least two characters. Pick a role first and it is applied to whoever you add.
        </p>
      ) : options.length === 0 ? (
        <p className="px-1 py-1 text-[11px] text-[var(--text-muted)]">
          {isFetching ? 'Searching…' : 'Nobody new matches that. Everyone already on the deal is hidden.'}
        </p>
      ) : (
        <div className="-mx-1 max-h-56 overflow-y-auto">
          {options.map((c: any) => (
            <button
              key={c.id}
              type="button"
              disabled={add.isPending}
              onClick={() => add.mutate(c.id)}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-surface)]"
            >
              <Avatar name={fullName(c)} email={c.email} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{fullName(c)}</span>
                <span className="block truncate text-[10.5px] text-[var(--text-tertiary)]">
                  {c.email}{c.job_title ? ` · ${c.job_title}` : ''}
                </span>
              </span>
              <Plus className="h-3.5 w-3.5 flex-shrink-0 text-[var(--indigo)]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── One person on the deal ───────────────────────────────────────────── */

function PersonRow({
  contactId, name, email, jobTitle, company, role, primary, onRole, onRemove, onEmail,
}: {
  contactId: string | null;
  name: string;
  email: string | null;
  jobTitle: string | null;
  company: string | null;
  role: string | null;
  primary?: boolean;
  onRole?: (role: string | null) => void;
  onRemove?: () => void;
  onEmail?: () => void;
}) {
  const { openPeek } = usePeek();
  const navigate = useNavigate();
  const [editingRole, setEditingRole] = useState(false);

  return (
    <div className="group rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[var(--bg-hover)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (contactId ? openPeek('contact', contactId) : undefined)}
          disabled={!contactId}
          title={contactId ? `Open ${name}` : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <Avatar name={name} email={email} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-[12.5px] font-medium text-[var(--text-primary)]',
                  contactId && 'group-hover:text-[var(--indigo)] group-hover:underline',
                )}
              >
                {name}
              </span>
              {primary && (
                <span title="The person this deal is nominally with">
                  <Crown className="h-3 w-3 flex-shrink-0 text-amber-500" />
                </span>
              )}
            </span>
            {(jobTitle || company) && (
              <span className="flex items-center gap-1 truncate text-[10.5px] text-[var(--text-tertiary)]">
                <Briefcase className="h-2.5 w-2.5 flex-shrink-0" />
                {[jobTitle, company].filter(Boolean).join(' @ ')}
              </span>
            )}
            {email && (
              <span className="flex items-center gap-1 truncate text-[10.5px] text-[var(--text-tertiary)]">
                <Mail className="h-2.5 w-2.5 flex-shrink-0" />{email}
              </span>
            )}
          </span>
        </button>

        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onEmail && email && (
            <button type="button" onClick={onEmail} className="icon-btn h-6 w-6" title={`Email ${name}`}>
              <Mail className="h-3.5 w-3.5" />
            </button>
          )}
          {contactId && (
            <button
              type="button"
              onClick={() => navigate(`/contacts/${contactId}`)}
              className="icon-btn h-6 w-6"
              title="Open the full profile"
            >
              <Star className="h-3.5 w-3.5" />
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} className="icon-btn h-6 w-6 hover:text-rose-500" title="Remove from this deal">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {onRole && (
        <div className="mt-1 pl-[34px]">
          {editingRole ? (
            <div className="flex flex-wrap gap-1">
              {PARTICIPANT_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { onRole(role === r ? null : r); setEditingRole(false); }}
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    role === r ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          ) : role ? (
            <button type="button" onClick={() => setEditingRole(true)} title="Change role">
              <RoleChip role={role} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditingRole(true)}
              className="text-[10.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--indigo)]"
            >
              Set a role…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── The panel ────────────────────────────────────────────────────────── */

export function DealPeople({
  deal, participants, onEmail,
}: {
  deal: Deal;
  participants: DealParticipant[];
  onEmail?: (email: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm'] });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string | null }) =>
      crmApi.updateParticipant(deal.id, id, { role }),
    onSuccess: invalidate,
    onError: () => toast.error('Could not change that role'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => crmApi.removeParticipant(deal.id, id),
    onSuccess: () => { invalidate(); toast.success('Removed from the deal'); },
    onError: () => toast.error('Could not remove them'),
  });

  const primaryId = deal.contact_id || deal.contact?.id || null;
  const primaryEmail = deal.contact?.email || deal.contact_email || null;
  const primaryName = fullName(deal.contact) !== 'Unknown'
    ? fullName(deal.contact)
    : deal.contact_name || primaryEmail || null;

  const excludeIds = new Set<string>(
    [primaryId, ...participants.map((p) => p.contact_id)].filter((x): x is string => !!x),
  );

  /*
   * The one thing this panel should shout about. A deal in proposal with no
   * decision maker named is the commonest way a forecast turns out to be
   * fiction, and the moment to notice is while there is still time to go
   * and find one.
   */
  const hasDecisionMaker = participants.some((p) => p.role === 'Decision maker');
  const total = (primaryId || primaryName ? 1 : 0) + participants.length;

  return (
    <div className="panel p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">People</p>
        {total > 0 && <span className="text-[11px] font-medium tabular-nums text-[var(--text-tertiary)]">{total}</span>}
        <span className="flex-1" />
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline"
          >
            <UserPlus className="h-3 w-3" /> Add
          </button>
        )}
      </div>

      {primaryName ? (
        <PersonRow
          contactId={primaryId}
          name={primaryName}
          email={primaryEmail}
          jobTitle={deal.contact?.job_title || null}
          company={deal.contact?.company || deal.company || null}
          role={null}
          primary
          onEmail={onEmail && primaryEmail ? () => onEmail(primaryEmail, primaryName) : undefined}
        />
      ) : (
        <p className="px-1.5 py-1 text-[11.5px] text-[var(--text-muted)]">
          No primary contact. Edit the deal to link one.
        </p>
      )}

      {participants.map((p) => (
        <PersonRow
          key={p.id}
          contactId={p.contact_id}
          name={fullName(p.contact)}
          email={p.contact?.email || null}
          jobTitle={p.contact?.job_title || null}
          company={p.contact?.company || null}
          role={p.role}
          onRole={(role) => setRole.mutate({ id: p.id, role })}
          onEmail={onEmail && p.contact?.email ? () => onEmail(p.contact!.email, fullName(p.contact)) : undefined}
          onRemove={() =>
            confirm(
              {
                title: `Remove ${fullName(p.contact)} from this deal?`,
                body: 'Their contact record and history stay exactly as they are. Only the link to this deal goes.',
                tone: 'danger',
              },
              () => remove.mutate(p.id),
            )
          }
        />
      ))}

      {adding && (
        <div className="mt-2">
          <AddParticipant
            dealId={deal.id}
            excludeIds={excludeIds}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {!adding && participants.length === 0 && (
        <p className="mt-1.5 px-1.5 text-[11px] text-[var(--text-muted)]">
          Add the other people involved and their emails join this deal&rsquo;s conversation.
        </p>
      )}

      {!hasDecisionMaker && deal.stage === 'proposal' && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <Building2 className="mt-px h-3 w-3 flex-shrink-0" />
          A proposal is out and nobody here is marked as the decision maker.
        </p>
      )}
    </div>
  );
}
