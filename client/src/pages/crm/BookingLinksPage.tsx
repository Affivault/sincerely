import { useState } from 'react';
import { Skeleton, SkeletonList } from '../../components/ui/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link2, Plus, Copy, Check, ExternalLink, Trash2, Eye, CalendarCheck,
  Loader2, Settings2, X, Clock, Video, Phone, MapPin, Calendar as CalendarIcon,
  AlertTriangle, Handshake, Mail, ChevronDown,
} from 'lucide-react';
import { bookingLinksApi, publicBookingUrl } from '../../api/booking.api';
import { calendarApi } from '../../api/calendar.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { slugify, type BookingLink, type CalendarEventType, formatDayMonthTime } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Booking links.

   The list is the page. Everything an account wants to know about a link is
   on its row - where it points, how long, whether it is live, how many
   people opened it and how many actually booked - and the one thing they
   want to DO with it, copy the address, is one click from anywhere.

   Editing happens in a panel beside the list rather than on another screen,
   because a link is half a dozen fields and a round trip through a detail
   page to change a headline is the kind of friction that stops people
   tidying anything up.
   ═══════════════════════════════════════════════════════════════════════ */

const LOCATION_ICON: Record<string, any> = {
  video: Video, phone: Phone, in_person: MapPin, other: CalendarIcon,
};

export function BookingLinksPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BookingLink | 'new' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ['booking-links'],
    queryFn: bookingLinksApi.list,
  });

  const { data: types = [] } = useQuery({
    queryKey: ['calendar', 'types'],
    queryFn: calendarApi.listTypes,
  });

  // A link that takes bookings and sends nothing is the worst outcome: the
  // account thinks it works and the prospect thinks they were ignored.
  const { data: readiness } = useQuery({
    queryKey: ['booking-links', 'readiness'],
    queryFn: bookingLinksApi.readiness,
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      bookingLinksApi.update(id, { is_active }),
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ['booking-links'] });
      toast.success(link.is_active ? 'Link is live' : 'Link paused');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change that'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => bookingLinksApi.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking-links'] });
      setEditing(null);
      toast.success('Link removed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not remove that'),
  });

  const copy = async (slug: string) => {
    const url = publicBookingUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /*
       * Clipboard access fails on an insecure origin and when the page is
       * not focused. A prompt is ugly but it is the difference between the
       * account getting its link and silently getting nothing.
       */
      window.prompt('Copy this address', url);
      return;
    }
    setCopied(slug);
    setTimeout(() => setCopied((c) => (c === slug ? null : c)), 1600);
  };

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <Link2 className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Booking links"
        description={
          links.length === 0
            ? 'A page anybody can open to put a meeting in your diary.'
            : `${links.filter((l) => l.is_active).length} live of ${links.length}`
        }
        actions={
          <button onClick={() => setEditing('new')} className="btn-primary" data-new-link>
            <Plus className="h-3.5 w-3.5" /> New link
          </button>
        }
      />

      {readiness && !readiness.can_email && links.length > 0 && (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2.5"
          data-no-mailbox
        >
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 flex-shrink-0 text-[var(--warning)]" />
          <p className="text-body text-[var(--text-primary)]">
            No mailbox connected, so nobody gets a confirmation.{' '}
            <span className="text-[var(--text-secondary)]">
              Bookings still land on your calendar, but the person who booked hears nothing.
            </span>{' '}
            <a href="/email-accounts" className="text-[var(--indigo)] hover:underline">
              Connect one
            </a>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 self-start space-y-2.5">
          {isLoading && (
            /* The shared placeholder rather than a bespoke one, so this
               loads identically to every other list. */
            <SkeletonList rows={3} />
          )}

          {!isLoading && links.length === 0 && (
            <div className="panel px-5 py-10 text-center" data-empty>
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-elevated)]">
                <Link2 className="h-5 w-5 text-[var(--text-tertiary)]" />
              </span>
              <h3 className="mt-3 text-heading font-semibold text-[var(--text-primary)]">
                No booking links yet
              </h3>
              <p className="mt-1 text-body text-[var(--text-secondary)] max-w-sm mx-auto">
                Make one and put it in a sequence. A reply that says &ldquo;sure, when?&rdquo;
                turns into a meeting without another email.
              </p>
              <button onClick={() => setEditing('new')} className="btn-primary mt-4">
                <Plus className="h-3.5 w-3.5" /> Create your first link
              </button>
            </div>
          )}

          {links.map((link) => {
            const Loc = LOCATION_ICON[link.event_type?.location_kind || 'video'] || CalendarIcon;
            const minutes = link.duration_minutes ?? link.event_type?.duration_minutes ?? 30;
            const colour = link.event_type?.colour || '#6366f1';
            const isOpen = typeof editing === 'object' && editing?.id === link.id;

            return (
              <div
                key={link.id}
                data-link={link.slug}
                className={cn(
                  'panel px-4 py-3 transition-colors',
                  isOpen && 'ring-1 ring-[var(--indigo)]',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 h-8 w-1 flex-shrink-0 rounded-full"
                    style={{ background: link.is_active ? colour : 'var(--border-subtle)' }}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className={cn(
                        'truncate text-strong font-semibold',
                        link.is_active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                      )}>
                        {link.headline}
                      </h3>
                      {!link.is_active && (
                        <span className="rounded px-1.5 py-[1px] text-micro font-medium bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
                          Paused
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => copy(link.slug)}
                      title="Copy this address"
                      className="mt-0.5 flex items-center gap-1 text-body text-[var(--text-secondary)] hover:text-[var(--indigo)]"
                      data-copy={link.slug}
                    >
                      <span className="truncate">/b/{link.slug}</span>
                      {copied === link.slug
                        ? <Check className="h-3 w-3 flex-shrink-0 text-[var(--green,#10b981)]" />
                        : <Copy className="h-3 w-3 flex-shrink-0" />}
                    </button>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--text-tertiary)]">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {minutes} min</span>
                      <span className="flex items-center gap-1"><Loc className="h-3 w-3" /> {link.event_type?.name || 'No kind set'}</span>
                      <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {link.views}</span>
                      <button
                        onClick={() => setOpened((o) => (o === link.id ? null : link.id))}
                        disabled={link.bookings === 0}
                        className={cn(
                          'flex items-center gap-1',
                          link.bookings > 0 && 'hover:text-[var(--indigo)]',
                        )}
                        data-open-bookings={link.slug}
                      >
                        <CalendarCheck className="h-3 w-3" /> {link.bookings} booked
                        {link.bookings > 0 && (
                          <ChevronDown className={cn(
                            'h-3 w-3 transition-transform',
                            opened === link.id && 'rotate-180',
                          )} />
                        )}
                      </button>
                      {link.create_deal && (
                        <span className="flex items-center gap-1" title="A booking opens a deal">
                          <Handshake className="h-3 w-3" />
                        </span>
                      )}
                      {link.notify_organiser && (
                        <span className="flex items-center gap-1" title="You are emailed on every booking">
                          <Mail className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-1">
                    <a
                      href={`/b/${link.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the page"
                      className="h-7 w-7 grid place-items-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => setEditing(link)}
                      title="Edit"
                      className="h-7 w-7 grid place-items-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </button>
                    <Switch
                      on={link.is_active}
                      onChange={(v) => toggle.mutate({ id: link.id, is_active: v })}
                    />
                  </div>
                </div>

                {opened === link.id && <Bookings linkId={link.id} />}
              </div>
            );
          })}
        </section>

        <section className="self-start">
          {editing ? (
            <Editor
              key={editing === 'new' ? 'new' : editing.id}
              link={editing === 'new' ? null : editing}
              types={types}
              onClose={() => setEditing(null)}
              onArchive={(id) => archive.mutate(id)}
            />
          ) : (
            <div className="panel px-4 py-5">
              <h3 className="text-strong font-semibold text-[var(--text-primary)]">
                How these work
              </h3>
              <ol className="mt-2 space-y-2 text-body leading-relaxed text-[var(--text-secondary)]">
                <li>
                  <strong className="text-[var(--text-primary)]">1.</strong> A link offers the
                  free times from your{' '}
                  <a href="/calendar/availability" className="text-[var(--indigo)] hover:underline">
                    working hours
                  </a>, minus whatever is already in your calendar.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">2.</strong> Whoever books
                  becomes a contact, and the meeting lands on your calendar in the colour of
                  its kind.
                </li>
                <li>
                  <strong className="text-[var(--text-primary)]">3.</strong> They can move or
                  cancel it themselves, so it never costs you an email.
                </li>
              </ol>
              <p className="mt-3 text-caption text-[var(--text-tertiary)]">
                In a sequence, <code className="rounded bg-[var(--bg-elevated)] px-1 py-[1px]">{'{{booking_link}}'}</code>{' '}
                becomes your first live link. It blanks if none is live, so a
                paused link never sends a dead address to a prospect.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Who booked through a link.
 *
 * Loaded only when asked for. The list of links is the page somebody keeps
 * open; fetching every link's bookings to render a number nobody clicked is
 * a request per link on every visit.
 */
function Bookings({ linkId }: { linkId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['booking-links', linkId, 'bookings'],
    queryFn: () => bookingLinksApi.bookings(linkId),
  });

  if (isLoading) {
    return (
      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
        <Skeleton className="h-8" />
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 space-y-1.5" data-bookings>
      {data.map((b: any) => {
        const past = new Date(b.starts_at).getTime() < Date.now();
        const off = b.status === 'cancelled';
        return (
          <div key={b.id} className="flex items-center gap-2 text-body">
            <span className={cn(
              'h-1.5 w-1.5 flex-shrink-0 rounded-full',
              off ? 'bg-[var(--text-tertiary)]' : past ? 'bg-[var(--border-strong,#a1a1aa)]' : 'bg-[var(--success)]',
            )} />
            <span className={cn(
              'min-w-0 flex-1 truncate',
              off ? 'text-[var(--text-tertiary)] line-through' : 'text-[var(--text-primary)]',
            )}>
              {b.contact_name || b.contact_email || 'Someone'}
            </span>
            <span className="flex-shrink-0 tabular text-[var(--text-secondary)]">
              {formatDayMonthTime(new Date(b.starts_at))}
            </span>
            {/* Which sequence produced it. The whole argument for owning
                the scheduler rather than linking out to one. */}
            {b.campaign?.name && (
              <span
                className="flex-shrink-0 max-w-[120px] truncate rounded bg-[var(--bg-elevated)] px-1.5 py-[1px] text-micro text-[var(--text-secondary)]"
                title={`Booked from ${b.campaign.name}`}
                data-campaign
              >
                {b.campaign.name}
              </span>
            )}
            {off && (
              <span className="flex-shrink-0 text-micro text-[var(--text-tertiary)]">
                {b.cancelled_by === 'invitee' ? 'they cancelled' : 'cancelled'}
              </span>
            )}
          </div>
        );
      })}
      {data.length === 0 && (
        <p className="text-body text-[var(--text-tertiary)]">Nothing booked through this yet.</p>
      )}
    </div>
  );
}

/* ── The editor ──────────────────────────────────────────────────────── */

function Editor({ link, types, onClose, onArchive }: {
  link: BookingLink | null;
  types: CalendarEventType[];
  onClose: () => void;
  onArchive: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    headline: link?.headline ?? 'Book a time with me',
    slug: link?.slug ?? '',
    blurb: link?.blurb ?? '',
    event_type_id: link?.event_type_id ?? types.find((t) => t.is_default)?.id ?? '',
    duration_minutes: link?.duration_minutes ?? null as number | null,
    collect_phone: link?.collect_phone ?? false,
    collect_company: link?.collect_company ?? false,
    question: link?.question ?? '',
    is_active: link?.is_active ?? true,
    create_deal: link?.create_deal ?? true,
    // Defaulted to the stage the dropdown already displays. Null would mean
    // the same thing to the server, but a form that shows "Lead" and saves
    // "unset" is a disagreement waiting to surface the day the first stage
    // is configurable.
    deal_stage: link?.deal_stage ?? 'lead',
    notify_organiser: link?.notify_organiser ?? true,
    confirmation_note: link?.confirmation_note ?? '',
  });
  // Only auto-derive the address while it has never been set by hand, so a
  // published link's URL never moves under somebody who has already sent it.
  const [slugTouched, setSlugTouched] = useState(!!link);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        headline: form.headline,
        slug: slugTouched ? form.slug : slugify(form.headline),
        blurb: form.blurb || null,
        event_type_id: form.event_type_id || null,
        duration_minutes: form.duration_minutes,
        collect_phone: form.collect_phone,
        collect_company: form.collect_company,
        question: form.question || null,
        is_active: form.is_active,
        create_deal: form.create_deal,
        deal_stage: form.deal_stage || null,
        notify_organiser: form.notify_organiser,
        confirmation_note: form.confirmation_note || null,
      };
      return link
        ? bookingLinksApi.update(link.id, payload)
        : bookingLinksApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking-links'] });
      toast.success(link ? 'Link saved' : 'Link created');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that'),
  });

  const chosenType = types.find((t) => t.id === form.event_type_id);
  const effectiveMinutes = form.duration_minutes ?? chosenType?.duration_minutes ?? 30;
  const previewSlug = slugTouched ? form.slug : slugify(form.headline);

  return (
    <div className="panel overflow-hidden" data-editor>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <h3 className="text-strong font-semibold text-[var(--text-primary)]">
          {link ? 'Edit link' : 'New booking link'}
        </h3>
        <button
          onClick={onClose}
          className="h-6 w-6 grid place-items-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <form
        className="px-4 py-3 space-y-3"
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      >
        <Field label="Headline" hint="What the page says at the top.">
          <input
            value={form.headline}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
            className="input-field w-full"
            maxLength={120}
          />
        </Field>

        <Field label="Address" hint="Where the link points. Permanent once you share it.">
          <div className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-2">
            <span className="text-body text-[var(--text-tertiary)] whitespace-nowrap">/b/</span>
            <input
              value={previewSlug}
              onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value }); }}
              className="h-8 flex-1 bg-transparent text-body text-[var(--text-primary)] outline-none"
              data-slug
            />
          </div>
        </Field>

        <Field label="Kind of meeting" hint="Sets the colour and the default length.">
          <select
            value={form.event_type_id}
            onChange={(e) => setForm({ ...form, event_type_id: e.target.value })}
            className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
          >
            <option value="">None</option>
            {types.filter((t) => !t.archived_at).map((t) => (
              <option key={t.id} value={t.id}>{t.name} &middot; {t.duration_minutes}m</option>
            ))}
          </select>
        </Field>

        <Field label="Length" hint={
          form.duration_minutes === null
            ? `Following the kind: ${effectiveMinutes} minutes.`
            : 'Overriding the kind for this link only.'
        }>
          <select
            value={form.duration_minutes ?? ''}
            onChange={(e) => setForm({
              ...form,
              duration_minutes: e.target.value === '' ? null : Number(e.target.value),
            })}
            className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
          >
            <option value="">Whatever the kind says</option>
            {[15, 20, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </Field>

        <Field label="Blurb" hint="A line or two under the headline. Optional.">
          <textarea
            rows={3}
            value={form.blurb}
            onChange={(e) => setForm({ ...form, blurb: e.target.value })}
            className="input-field w-full resize-none"
            maxLength={600}
          />
        </Field>

        <Field label="A question to ask" hint="Shown on the form. Optional.">
          <input
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="What would you like to cover?"
            className="input-field w-full"
            maxLength={200}
          />
        </Field>

        <Field label="What they get told" hint="Added to the confirmation email. Dial-in details, what to bring.">
          <textarea
            rows={2}
            value={form.confirmation_note}
            onChange={(e) => setForm({ ...form, confirmation_note: e.target.value })}
            placeholder="I will send a Meet link the morning of."
            className="input-field w-full resize-none"
            maxLength={2000}
            data-note
          />
        </Field>

        <Field label="When somebody books" hint="A meeting agreed is the most useful thing in a pipeline.">
          <select
            value={form.create_deal ? (form.deal_stage || 'lead') : 'none'}
            onChange={(e) => setForm({
              ...form,
              create_deal: e.target.value !== 'none',
              deal_stage: e.target.value === 'none' ? '' : e.target.value,
            })}
            className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
            data-deal
          >
            <option value="none">Just book it</option>
            <option value="lead">Open a deal at Lead</option>
            <option value="qualified">Open a deal at Qualified</option>
            <option value="proposal">Open a deal at Proposal</option>
          </select>
        </Field>

        <div className="space-y-1.5 pt-1">
          <Check2
            on={form.notify_organiser}
            onChange={(v) => setForm({ ...form, notify_organiser: v })}
            label="Email me when somebody books"
          />
          <Check2
            on={form.collect_company}
            onChange={(v) => setForm({ ...form, collect_company: v })}
            label="Ask for their company"
          />
          <Check2
            on={form.collect_phone}
            onChange={(v) => setForm({ ...form, collect_phone: v })}
            label="Ask for a phone number"
          />
          <Check2
            on={form.is_active}
            onChange={(v) => setForm({ ...form, is_active: v })}
            label="Taking bookings"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={save.isPending} className="btn-primary flex-1 justify-center">
            {save.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Check className="h-3.5 w-3.5" />}
            {link ? 'Save' : 'Create link'}
          </button>
          {link && (
            <button
              type="button"
              onClick={() => onArchive(link.id)}
              title="Remove this link"
              className="btn-secondary text-[var(--error)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────── */

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-body font-medium text-[var(--text-primary)]">{label}</span>
      {hint && <span className="block text-caption text-[var(--text-tertiary)]">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title={on ? 'Taking bookings' : 'Paused'}
      className={cn(
        'relative h-5 w-9 flex-shrink-0 rounded-full transition-colors',
        on ? 'bg-[var(--indigo)]' : 'bg-[var(--border-subtle)]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function Check2({ on, onChange, label }: {
  on: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <span
        onClick={() => onChange(!on)}
        className={cn(
          'grid h-4 w-4 place-items-center rounded border transition-colors',
          on
            ? 'border-[var(--indigo)] bg-[var(--indigo)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
        )}
      >
        {on && <Check className="h-3 w-3 text-white" />}
      </span>
      <span className="text-body text-[var(--text-primary)]">{label}</span>
    </label>
  );
}
