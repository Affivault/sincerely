import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, AlertTriangle, CornerDownRight, Mail, Users } from 'lucide-react';
import { TAG_LABELS, formatDateTime, type CampaignPreview } from '@lemlist/shared';
import { campaignsApi, type PreviewRequest } from '../../api/campaigns.api';
import { contactsApi } from '../../api/contacts.api';
import { useDebounce } from '../../hooks/useDebounce';
import { AsyncPanel } from '../ui/AsyncPanel';
import { EmailBody } from '../shared/EmailBody';
import { Avatar } from '../shared/Avatar';
import { cn } from '../../lib/utils';
import { keepPrevious } from '../../lib/listQuery';
import { Refreshing } from '../ui/Refreshing';

/**
 * Read the whole sequence as one real person before it goes to them.
 *
 * The step editor previews one email against whoever is next in the list.
 * This answers the question asked just before launch: pick Ada - from the
 * audience or anyone in Contacts - and read every email exactly as she
 * will, rendered on the server through the send path itself (merge tags,
 * the booking link, "Re:" threading, the mailbox it comes from, the
 * wording spintax picks for her). Gaps in her record are flagged on the
 * email they spoil, and the footer says how many others share them.
 */

export interface AudiencePerson {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
}

const nameOf = (p: AudiencePerson) => [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email;
const label = (tag: string) => (TAG_LABELS[tag] || tag.replace(/_/g, ' ')).toLowerCase();

export function ContactPreviewPanel({
  campaignId,
  draft,
  audience,
}: {
  /** Null for a campaign the builder has not saved yet. */
  campaignId: string | null;
  /** The builder's unsaved state; absent on a launched campaign, which previews what is saved. */
  draft?: Omit<PreviewRequest, 'contact_id'>;
  /** A few people from the audience to pick from without searching. */
  audience: AudiencePerson[];
}) {
  const [chosen, setChosen] = useState<AudiencePerson | null>(null);
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const person = chosen ?? audience[0] ?? null;

  const { data: found, isFetching: searching, isPlaceholderData: staleResults } = useQuery({
    queryKey: ['contacts', 'preview-search', term],
    queryFn: async () => (await contactsApi.list({ search: term, limit: 8, lifecycle: 'all' })).data || [],
    enabled: term.length >= 2,
    staleTime: 30_000,
    // The last matches stay while the next ones load, marked as refreshing.
    ...keepPrevious,
  });

  // Typing in the editor should not fire a render per keystroke: the
  // preview follows the copy, a moment behind it.
  const debouncedDraft = useDebounce(draft, 700);
  const draftKey = useMemo(() => (debouncedDraft ? JSON.stringify({
    steps: debouncedDraft.steps,
    pool: debouncedDraft.sender_pool_ids,
    box: debouncedDraft.smtp_account_id,
    unsub: debouncedDraft.include_unsubscribe,
    // The ids themselves can run to thousands; their count and ends are
    // enough to notice the audience changed.
    n: debouncedDraft.audience_contact_ids?.length ?? 0,
    a: debouncedDraft.audience_contact_ids?.[0],
    z: debouncedDraft.audience_contact_ids?.[(debouncedDraft.audience_contact_ids?.length ?? 1) - 1],
  }) : 'saved'), [debouncedDraft]);

  const preview = useQuery({
    queryKey: ['campaign-preview', campaignId, person?.id, draftKey],
    queryFn: () => campaignsApi.preview(campaignId, { contact_id: person!.id, ...(debouncedDraft || {}) }),
    enabled: !!person && (!!campaignId || !!debouncedDraft),
    // Switching person keeps the last render up, marked as refreshing by
    // AsyncPanel, instead of collapsing the page to a skeleton.
    ...keepPrevious,
    staleTime: 30_000,
  });

  const pick = (p: AudiencePerson) => { setChosen(p); setSearch(''); };
  const inAudience = new Set(audience.map((p) => p.id));
  const options = term.length >= 2 ? (found || []) as AudiencePerson[] : audience.slice(0, 8);

  return (
    <div className="panel p-4 space-y-4" data-contact-preview>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-strong font-semibold text-[var(--text-primary)]">Preview as a real contact</h2>
          <p className="text-caption text-[var(--text-tertiary)] mt-0.5">
            Every email, exactly as this person will get it. Tracking is left out.
          </p>
        </div>
      </div>

      {/* Who */}
      <div className="space-y-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any contact by name, email or company..."
            aria-label="Search contacts to preview as"
            className="w-full h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-8 pr-8 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn h-6 w-6">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Refreshing active={staleResults && term.length >= 2}>
        <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Preview as">
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={person?.id === p.id}
              onClick={() => pick(p)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-caption font-medium max-w-[16rem]',
                person?.id === p.id
                  ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-surface)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
              )}
              title={p.email}
            >
              <span className="truncate">{nameOf(p)}</span>
              {term.length >= 2 && !inAudience.has(p.id) && campaignId === null && (
                <span className="opacity-70">(not in audience)</span>
              )}
            </button>
          ))}
          {term.length >= 2 && !searching && (found || []).length === 0 && (
            <span className="text-caption text-[var(--text-tertiary)]">Nobody matches &ldquo;{term}&rdquo;.</span>
          )}
          {term.length < 2 && audience.length === 0 && (
            <span className="text-caption text-[var(--text-tertiary)]">Add people to the campaign, or search for anyone in Contacts.</span>
          )}
        </div>
        </Refreshing>
      </div>

      {person && (
        <AsyncPanel query={preview} skeleton="list" skeletonRows={3}>
          {(data) => <PreviewBody data={data} />}
        </AsyncPanel>
      )}
    </div>
  );
}

function PreviewBody({ data }: { data: CampaignPreview }) {
  const { contact, sender, emails, audience } = data;
  return (
    <div className="space-y-3">
      {/* From and to, once: they are the same for every email. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-body">
        <span className="text-[var(--text-secondary)]">
          <span className="text-[var(--text-tertiary)]">From </span>
          {sender
            ? <><span className="font-medium text-[var(--text-primary)]">{sender.from_name}</span> &lt;{sender.email}&gt;</>
            : <span className="text-[var(--error)]">no mailbox can send this campaign yet</span>}
        </span>
        <span className="text-[var(--text-secondary)]">
          <span className="text-[var(--text-tertiary)]">To </span>
          <span className="font-medium text-[var(--text-primary)]">{contact.name}</span> &lt;{contact.email}&gt;
          {contact.company ? ` · ${contact.company}` : ''}
        </span>
      </div>
      {sender && (sender.pinned || sender.rotation > 1) && (
        <p className="text-caption text-[var(--text-tertiary)]">
          {sender.pinned
            ? 'Their emails so far came from this mailbox, so the follow-ups do too.'
            : `One of ${sender.rotation} mailboxes this campaign rotates through; follow-ups stay with whichever sends the first.`}
        </p>
      )}
      {!data.enrolled && (
        <p className="text-caption text-[var(--text-tertiary)]">
          Not in this campaign yet. Where the copy has wording variants, the ones shown may differ from what they get once added.
        </p>
      )}

      <ol className="space-y-3">
        {emails.map((e) => (
          <li key={`${e.step_id ?? 'draft'}-${e.step_order}`} className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              {e.thread === 'reply'
                ? <CornerDownRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden />
                : <Mail className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden />}
              <span className="text-micro font-semibold text-[var(--text-tertiary)]">
                Email {e.position}{e.thread === 'reply' ? ' · reply in thread' : ''}{e.variant ? ` · version ${e.variant.toUpperCase()}` : ''}
              </span>
              {e.sent_at && (
                <span className="text-micro text-[var(--text-tertiary)]">· sent {formatDateTime(e.sent_at)}</span>
              )}
              <span className="w-full text-strong font-medium text-[var(--text-primary)] break-words">
                {e.subject || <span className="text-[var(--text-tertiary)]">(no subject)</span>}
              </span>
            </div>
            {(e.problem || e.blanks.length > 0) && (
              <div className="flex items-start gap-2 px-3 py-2 border-b border-[var(--border-subtle)] text-caption text-[var(--text-secondary)]" data-preview-gap>
                <AlertTriangle className="h-3.5 w-3.5 mt-px flex-shrink-0 text-[var(--warning)]" />
                <span>
                  {e.problem && <>{e.problem} </>}
                  {e.blanks.length > 0 && (
                    <>{contact.name} has no {e.blanks.map(label).join(' or ')}, so {e.blanks.length === 1 ? 'that spot is' : 'those spots are'} blank in this email.</>
                  )}
                </span>
              </div>
            )}
            <EmailBody html={e.html} text={null} />
          </li>
        ))}
        {emails.length === 0 && (
          <li className="text-body text-[var(--text-tertiary)]">There are no email steps to preview.</li>
        )}
      </ol>

      {/* Everyone else. */}
      {audience.total > 0 && audience.tags.length > 0 && (
        <div className="flex items-start gap-2 pt-3 border-t border-[var(--border-subtle)] text-caption text-[var(--text-secondary)]" data-preview-audience>
          <Users className="h-3.5 w-3.5 mt-px flex-shrink-0 text-[var(--text-tertiary)]" />
          <span>
            {audience.with_gaps === 0
              ? <>Everyone in the audience{audience.capped ? ` (first ${audience.total.toLocaleString()} checked)` : ''} has a value for every tag the copy uses.</>
              : <>
                  <span className="font-medium text-[var(--text-primary)]">{audience.with_gaps.toLocaleString()}</span> of {audience.total.toLocaleString()}
                  {audience.capped ? ' checked' : ''} would get a gap somewhere:{' '}
                  {audience.tags.filter((t) => t.missing > 0).map((t) => `${t.missing.toLocaleString()} have no ${t.label.toLowerCase()}`).join(', ')}.
                  {' '}A fallback like <code className="font-mono">{`{{${audience.tags.find((t) => t.missing > 0)?.name || 'first_name'}|there}}`}</code> fills it.
                </>}
          </span>
        </div>
      )}
    </div>
  );
}
