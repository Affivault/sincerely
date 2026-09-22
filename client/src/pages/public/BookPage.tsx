import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Clock, Video, Phone, MapPin, Globe, Calendar as CalendarIcon,
  ChevronLeft, ChevronRight, Check, Loader2, ArrowLeft, Download, AlertCircle,
} from 'lucide-react';
import { publicBookingApi, type WireSlot } from '../../api/booking.api';
import { WEEKDAY_SHORT, PLACEHOLDER } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { PublicShell } from './PublicShell';
import { keepPrevious } from '../../lib/listQuery';

/* ═══════════════════════════════════════════════════════════════════════
   The booking page.

   The only screen in this product a stranger sees, which changes what it
   has to do. There is no navigation to fall back on, no support article,
   and nobody to ask. Whatever goes wrong has to explain itself on the spot.

   Three steps, in the order people actually think: which day, which time,
   and then who are you. The first two are one screen because choosing a day
   with no idea what is free on it is a guessing game - the month grid marks
   the days that have anything, so a click is never wasted.
   ═══════════════════════════════════════════════════════════════════════ */

const LOCATION_ICON = {
  video: Video, phone: Phone, in_person: MapPin, other: CalendarIcon,
} as const;

const LOCATION_LABEL = {
  video: 'Video call', phone: 'Phone call', in_person: 'In person', other: 'Details to follow',
} as const;

/** The visitor's own zone, which is the one the times should be quoted in. */
function guessZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A stable YYYY-MM-DD for a date as seen in a given zone. */
function dayKey(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function BookPage() {
  const { slug = '' } = useParams();
  // The signed token a campaign email put on the link. Absent for anybody
  // arriving from a signature, a website or a forwarded message.
  const [params] = useSearchParams();
  const k = params.get('k') || undefined;
  const [zone, setZone] = useState(guessZone);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<WireSlot | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', answer: '' });
  const [booked, setBooked] = useState<any | null>(null);

  const page = useQuery({
    queryKey: ['public-booking', slug, k],
    queryFn: () => publicBookingApi.page(slug, k),
    retry: false,
  });

  /*
   * Slots are fetched a month at a time rather than a day at a time. A day
   * at a time means a spinner on every click; a month is one request and the
   * grid can then mark which days have anything, which is the thing that
   * makes the picker worth having.
   */
  const range = useMemo(() => {
    const first = new Date(month);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    // Never ask for times in the past - the server would drop them anyway,
    // and asking makes the first month look emptier than the next.
    const from = first.getTime() < Date.now() ? new Date() : first;
    return { from: from.toISOString(), to: last.toISOString() };
  }, [month]);

  const slots = useQuery({
    queryKey: ['public-booking-slots', slug, range.from, range.to],
    queryFn: () => publicBookingApi.slots(slug, range.from, range.to),
    enabled: !!page.data,
    retry: false,
    ...keepPrevious,
  });

  /** Slots grouped by the day they fall on *in the visitor's zone*. */
  const byDay = useMemo(() => {
    const m = new Map<string, WireSlot[]>();
    for (const s of slots.data || []) {
      const key = dayKey(new Date(s.start), zone);
      const list = m.get(key);
      if (list) list.push(s); else m.set(key, [s]);
    }
    return m;
  }, [slots.data, zone]);

  /*
   * Fill in what the link already knows.
   *
   * Guarded on the fields being untouched rather than run once on mount:
   * the page query resolves after the first render, so a plain mount effect
   * would fire before there is anything to fill. Anything typed since wins,
   * because a prospect correcting their own address must not be overwritten
   * by what a CSV said six weeks ago.
   */
  const invitee = page.data?.invitee;
  useEffect(() => {
    if (!invitee) return;
    setForm((f) => (f.name || f.email ? f : {
      ...f,
      name: invitee.name || '',
      email: invitee.email || '',
      company: invitee.company || '',
    }));
  }, [invitee]);

  // Land on the first day that has anything, so the page is never a grid of
  // dead squares with no hint where to click.
  useEffect(() => {
    if (chosenDay || byDay.size === 0) return;
    setChosenDay([...byDay.keys()].sort()[0]);
  }, [byDay, chosenDay]);

  const booking = useMutation({
    mutationFn: () => publicBookingApi.book(slug, {
      start: chosenSlot!.start,
      name: form.name,
      email: form.email,
      phone: form.phone || undefined,
      company: form.company || undefined,
      answer: form.answer || undefined,
      timezone: zone,
    }, k),
    onSuccess: (data) => setBooked(data),
  });

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: zone,
  });
  const fmtLong = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone,
  });

  /* ── The page could not be loaded at all ── */
  if (page.isError) {
    const status = (page.error as any)?.response?.status;
    return (
      <PublicShell>
        <div className="text-center py-16" data-state="error">
          <AlertCircle className="h-8 w-8 mx-auto text-[var(--text-tertiary)]" />
          <h1 className="mt-3 text-title font-semibold text-[var(--text-primary)]">
            {status === 403 ? 'This page is not taking bookings' : 'Nothing here'}
          </h1>
          <p className="mt-1 text-strong text-[var(--text-secondary)] max-w-sm mx-auto">
            {status === 403
              ? 'The person you are trying to reach has paused it. Try them another way.'
              : 'There is no booking page at this address. Check the link you were sent.'}
          </p>
        </div>
      </PublicShell>
    );
  }

  if (page.isLoading || !page.data) {
    return (
      <PublicShell>
        <div className="py-20 flex items-center justify-center text-[var(--text-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </PublicShell>
    );
  }

  const p = page.data;
  const LocIcon = LOCATION_ICON[p.location_kind] ?? CalendarIcon;

  /* ── Booked ── */
  if (booked) {
    return (
      <PublicShell>
        <div className="text-center py-10" data-state="booked">
          <span
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: `color-mix(in srgb, ${p.colour} 18%, transparent)` }}
          >
            <Check className="h-6 w-6" style={{ color: p.colour }} />
          </span>
          <h1 className="mt-4 text-title font-semibold text-[var(--text-primary)]">
            You are booked in
          </h1>
          <p className="mt-1 text-strong text-[var(--text-secondary)]">
            {fmtLong(booked.start)} at <strong className="text-[var(--text-primary)]">{fmtTime(booked.start)}</strong>
          </p>
          <p className="mt-0.5 text-body text-[var(--text-tertiary)]">
            {p.duration_minutes} minutes with {p.organiser} &middot; times shown in {zone.replace(/_/g, ' ')}
          </p>

          <div className="mt-6 flex items-center justify-center gap-2">
            <a
              href={publicBookingApi.icsUrl(booked.manage_token)}
              className="btn-secondary"
            >
              <Download className="h-3.5 w-3.5" />
              Add to calendar
            </a>
            <a href={`/booking/${booked.manage_token}`} className="btn-secondary">
              Change or cancel
            </a>
          </div>
          <p className="mt-4 text-caption text-[var(--text-tertiary)] max-w-sm mx-auto">
            Keep this page, or the link above, if you need to move it later.
          </p>
        </div>
      </PublicShell>
    );
  }

  /* ── Details, once a time is chosen ── */
  if (chosenSlot) {
    const invalid = !form.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
    return (
      <PublicShell>
        <Header page={p} LocIcon={LocIcon} />
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-5">
          <button
            onClick={() => { setChosenSlot(null); booking.reset(); }}
            className="flex items-center gap-1 text-body text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Pick a different time
          </button>

          <div
            className="mt-3 rounded-lg border px-3 py-2.5"
            style={{
              borderColor: `color-mix(in srgb, ${p.colour} 35%, var(--border-subtle))`,
              background: `color-mix(in srgb, ${p.colour} 8%, var(--bg-surface))`,
            }}
          >
            <p className="text-strong font-medium text-[var(--text-primary)]">
              {fmtLong(chosenSlot.start)}
            </p>
            <p className="text-body text-[var(--text-secondary)]">
              {fmtTime(chosenSlot.start)} &ndash; {fmtTime(chosenSlot.end)} &middot; {zone.replace(/_/g, ' ')}
            </p>
          </div>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (!invalid) booking.mutate(); }}
          >
            <Field label="Your name" required>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-field w-full"
                placeholder={PLACEHOLDER.contactName}
              />
            </Field>
            <Field label="Email" required hint="Where the confirmation goes.">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input-field w-full"
                placeholder="jordan@company.com"
              />
            </Field>
            {p.collect_company && (
              <Field label="Company">
                <input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  className="input-field w-full"
                />
              </Field>
            )}
            {p.collect_phone && (
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="input-field w-full"
                />
              </Field>
            )}
            {p.question && (
              <Field label={p.question}>
                <textarea
                  rows={3}
                  value={form.answer}
                  onChange={(e) => setForm({ ...form, answer: e.target.value })}
                  className="input-field w-full resize-none"
                />
              </Field>
            )}

            {booking.isError && (
              <p
                className="flex items-start gap-1.5 rounded-md border border-[var(--red-border,rgba(239,68,68,0.3))] bg-[rgba(239,68,68,0.08)] px-2.5 py-2 text-body text-[var(--text-primary)]"
                data-error
              >
                <AlertCircle className="h-3.5 w-3.5 mt-[1px] flex-shrink-0 text-[#ef4444]" />
                {(booking.error as any)?.response?.data?.error
                  || 'That did not go through. Try again in a moment.'}
              </p>
            )}

            <button
              type="submit"
              disabled={invalid || booking.isPending}
              className="btn-primary w-full justify-center"
              style={{ background: invalid ? undefined : p.colour, borderColor: p.colour }}
            >
              {booking.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Booking&hellip;</>
                : `Book ${p.duration_minutes} minutes`}
            </button>
          </form>
        </div>
      </PublicShell>
    );
  }

  /* ── Pick a day and a time ── */
  const todayKey = dayKey(new Date(), zone);
  const dayList = chosenDay ? (byDay.get(chosenDay) || []) : [];

  return (
    <PublicShell wide>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,260px)_1fr_minmax(0,190px)] gap-0 md:gap-6">
        {/* Who, what, how long */}
        <div className="md:border-r md:border-[var(--border-subtle)] md:pr-6">
          <Header page={p} LocIcon={LocIcon} />
          {p.blurb && (
            <p className="mt-3 text-strong leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
              {p.blurb}
            </p>
          )}
          <label className="mt-5 block">
            <span className="flex items-center gap-1.5 text-caption font-medium text-[var(--text-tertiary)]">
              <Globe className="h-3 w-3" /> Times shown in
            </span>
            <select
              value={zone}
              onChange={(e) => { setZone(e.target.value); setChosenDay(null); }}
              className="mt-1 h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              data-zone
            >
              {zoneOptions(zone).map((z) => (
                <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
        </div>

        {/* The month */}
        <div className="mt-6 md:mt-0">
          <MonthGrid
            month={month}
            onMonth={setMonth}
            zone={zone}
            byDay={byDay}
            chosen={chosenDay}
            onChoose={(k) => { setChosenDay(k); setChosenSlot(null); }}
            loading={slots.isFetching}
            todayKey={todayKey}
            colour={p.colour}
            horizonDays={p.horizon_days}
          />
        </div>

        {/* The times on that day */}
        <div className="mt-6 md:mt-0 md:border-l md:border-[var(--border-subtle)] md:pl-6">
          {chosenDay ? (
            <>
              <p className="text-body font-semibold text-[var(--text-primary)]">
                {new Date(`${chosenDay}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </p>
              <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
                {dayList.length} time{dayList.length === 1 ? '' : 's'} free
              </p>
              {/*
                No max-height. A capped column cuts the last time in half and
                reads as broken, and a fade to hint at scrolling dims a row
                that is often the only one. The card grows and the page
                scrolls, which is what a long day should do.
              */}
              <div className="mt-2.5 space-y-1.5" data-times>
                {dayList.map((s) => (
                  <button
                    key={s.start}
                    onClick={() => setChosenSlot(s)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-strong tabular font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--indigo)]"
                    style={{ ['--tw-ring-color' as any]: p.colour }}
                  >
                    {fmtTime(s.start)}
                  </button>
                ))}
                {dayList.length === 0 && (
                  <p className="text-body text-[var(--text-tertiary)]">
                    Nothing free on this day.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-body text-[var(--text-tertiary)]" data-empty>
              {slots.isFetching
                ? 'Looking at the diary…'
                : 'No free times in this month. Try the next one.'}
            </p>
          )}
        </div>
      </div>
    </PublicShell>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────── */


function Header({ page, LocIcon }: { page: any; LocIcon: any }) {
  const firstName = (page.invitee?.name || '').split(/\s+/)[0];
  return (
    <div>
      <p className="text-body font-medium text-[var(--text-tertiary)]" data-organiser>
        {firstName ? `${firstName}, book a time with ${page.organiser}` : page.organiser}
      </p>
      <h1 className="mt-0.5 text-title font-semibold leading-snug text-[var(--text-primary)]">
        {page.headline}
      </h1>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-[var(--text-secondary)]">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {page.duration_minutes} min
        </span>
        <span className="flex items-center gap-1">
          <LocIcon className="h-3.5 w-3.5" /> {LOCATION_LABEL[page.location_kind as keyof typeof LOCATION_LABEL]}
        </span>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-body font-medium text-[var(--text-primary)]">
        {label}{required && <span className="text-[#ef4444]"> *</span>}
      </span>
      {hint && <span className="block text-caption text-[var(--text-tertiary)]">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function MonthGrid({
  month, onMonth, zone, byDay, chosen, onChoose, loading, todayKey, colour, horizonDays,
}: {
  month: Date; onMonth: (d: Date) => void; zone: string;
  byDay: Map<string, any[]>; chosen: string | null; onChoose: (k: string) => void;
  loading: boolean; todayKey: string; colour: string; horizonDays: number;
}) {
  /*
   * The grid is built in local dates rather than UTC. A cell is a square on
   * a wall calendar, and a wall calendar has no offset - whereas the slots
   * inside it are instants, which is why they are keyed through the zone.
   */
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const thisMonth = new Date();
  const atStart = month.getFullYear() === thisMonth.getFullYear() && month.getMonth() === thisMonth.getMonth();
  // Past the horizon there is nothing to find, so the arrow stops rather
  // than walking somebody through empty months.
  const horizonEnd = new Date(Date.now() + horizonDays * 86_400_000);
  const atEnd = month.getFullYear() > horizonEnd.getFullYear()
    || (month.getFullYear() === horizonEnd.getFullYear() && month.getMonth() >= horizonEnd.getMonth());

  const step = (by: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-strong font-semibold text-[var(--text-primary)]">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-[var(--text-tertiary)]" />}
          <button
            onClick={() => step(-1)}
            disabled={atStart}
            aria-label="Previous month"
            className="h-7 w-7 grid place-items-center rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-35 hover:bg-[var(--bg-elevated)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => step(1)}
            disabled={atEnd}
            aria-label="Next month"
            className="h-7 w-7 grid place-items-center rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-35 hover:bg-[var(--bg-elevated)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="text-center text-micro font-medium text-[var(--text-tertiary)] pb-1">
            {d[0]}
          </div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={`pad-${i}`} />;
          const has = (byDay.get(key) || []).length > 0;
          const isChosen = key === chosen;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              disabled={!has}
              onClick={() => onChoose(key)}
              data-day={key}
              data-has={has ? 'yes' : 'no'}
              className={cn(
                'relative aspect-square rounded-lg text-body tabular transition-colors',
                has
                  ? 'font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  : 'text-[var(--text-tertiary)] opacity-40 cursor-default',
                isChosen && 'text-white hover:brightness-95',
              )}
              style={isChosen ? { background: colour, color: '#fff' } : undefined}
            >
              {Number(key.slice(8))}
              {/* A dot, not a colour wash: the thing being communicated is
                  "there is something here", and it has to survive the day
                  also being today and also being selected. */}
              {has && !isChosen && (
                <span
                  className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ background: colour }}
                />
              )}
              {isToday && !isChosen && (
                <span className="absolute inset-0 rounded-lg ring-1 ring-inset ring-[var(--border-strong,var(--border-subtle))]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A short list of zones, not all six hundred.
 *
 * The visitor's own is detected and first; the rest are the ones somebody
 * might plausibly switch to when booking across a border. A full list is a
 * scroll nobody wants on the one screen that has to convert.
 */
function zoneOptions(current: string): string[] {
  const common = [
    'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Europe/Lisbon', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Moscow',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City',
    'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong',
    'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
  ];
  return [current, ...common.filter((z) => z !== current)];
}
