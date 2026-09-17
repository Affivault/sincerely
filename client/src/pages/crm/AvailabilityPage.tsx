import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock, Plus, X, Loader2, Check, Globe, CalendarCheck,
  RefreshCw, AlertTriangle,
} from 'lucide-react';
import {
  WEEKDAY_NAMES, SLOT_INTERVALS, minuteLabel, parseMinuteLabel, describeWeek,
  DEFAULT_SCHEDULING_PREFS, durationLabel,
  type AvailabilityWindow, type SchedulingPrefs,
} from '@lemlist/shared';
import { availabilityApi, type AvailabilityResponse } from '../../api/calendar.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   When people may book you.

   Half a scheduler. The other half - a link a stranger can open - comes
   next, and will be worthless if this part is wrong, because every slot it
   offers comes from here.

   The preview at the bottom is the point of the page: rules like "four
   hours' notice" and "fifteen minutes either side" are impossible to hold
   in your head, and a settings screen that will not show you their effect
   is asking you to guess. It calls the same endpoint the booking page will,
   so what it shows is what a stranger would be offered.
   ═══════════════════════════════════════════════════════════════════════ */

/** Common hours, so the usual case is two clicks rather than eight. */
const PRESETS: { label: string; windows: AvailabilityWindow[] }[] = [
  {
    label: 'Weekdays 9–5',
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 540, end_minute: 1020 })),
  },
  {
    label: 'Weekdays 9–5, lunch off',
    windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, start_minute: 540, end_minute: 780 },
      { weekday, start_minute: 840, end_minute: 1020 },
    ]),
  },
  {
    label: 'Mornings only',
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 540, end_minute: 720 })),
  },
];

/**
 * Calendars kept somewhere else.
 *
 * The one part of availability that is about correctness rather than
 * preference: without it, the page offers times the account is already busy
 * in, and the person who connected a calendar precisely so that would not
 * happen is the one it happens to.
 */
function ExternalCalendars() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const { data } = useQuery({
    queryKey: ['calendar', 'connections'],
    queryFn: availabilityApi.connections,
  });

  // The OAuth callback lands back here with a result in the query string.
  useEffect(() => {
    const outcome = params.get('calendar');
    if (!outcome) return;
    if (outcome === 'connected') toast.success(`Connected ${params.get('account') || 'your calendar'}`);
    else if (outcome === 'error') toast.error(params.get('message') || 'Could not connect');
    // Google sends the same code whether somebody pressed Cancel or was
    // refused for being off the test-user list, so this says both rather
    // than guessing - and stays on screen long enough to be read and acted
    // on, which a two-second toast would not be.
    else if (outcome === 'denied') {
      toast(params.get('message') || 'Google did not allow that connection.', {
        icon: '\u26A0\uFE0F', duration: 12000,
      });
    }
    qc.invalidateQueries({ queryKey: ['calendar', 'connections'] });
    const next = new URLSearchParams(params);
    ['calendar', 'account', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }, [params, qc, setParams]);

  const connect = useMutation({
    mutationFn: availabilityApi.authorizeGoogle,
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not start that'),
  });

  const drop = useMutation({
    mutationFn: (id: string) => availabilityApi.disconnect(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      toast.success('Disconnected');
    },
  });

  const toggleWrite = useMutation({
    mutationFn: ({ id, write_events }: { id: string; write_events: boolean }) =>
      availabilityApi.updateConnection(id, { write_events }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar', 'connections'] }),
  });

  if (!data) return null;
  const connections = data.connections || [];

  return (
    <section className="panel overflow-hidden" data-connections>
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
          <RefreshCw className="h-3.5 w-3.5 text-[var(--indigo)]" />
          Your other calendars
        </h3>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
          So a booking page never offers a time you are already busy in.
        </p>
      </div>

      <div className="px-4 py-3 space-y-2">
        {!data.available ? (
          <p className="text-[12px] text-[var(--text-secondary)]" data-unavailable>
            Google Calendar is not set up on this deployment yet. Until it is,
            only meetings booked here count against your availability.
          </p>
        ) : connections.length === 0 ? (
          <>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Nothing connected. Meetings in your Google calendar will not block
              a slot, so the page can offer a time you already have something in.
            </p>
            <button
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="btn-secondary w-full justify-center"
              data-connect
            >
              {connect.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Connect Google Calendar
            </button>
          </>
        ) : (
          connections.map((c) => (
            <div key={c.id} data-connection={c.id} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                  c.broken_at ? 'bg-[#ef4444]' : 'bg-[#10b981]',
                )} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-primary)]">
                  {c.account_email || 'Google Calendar'}
                </span>
                <button
                  onClick={() => drop.mutate(c.id)}
                  className="text-[11.5px] text-[var(--text-tertiary)] hover:text-[#ef4444]"
                >
                  Disconnect
                </button>
              </div>

              {c.broken_at ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-[#ef4444]" data-broken>
                  <AlertTriangle className="mt-[1px] h-3 w-3 flex-shrink-0" />
                  {c.broken_reason || 'Reconnect needed.'}
                  <button
                    onClick={() => connect.mutate()}
                    className="underline hover:no-underline"
                  >
                    Reconnect
                  </button>
                </p>
              ) : (
                <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={c.write_events}
                    onChange={(e) => toggleWrite.mutate({ id: c.id, write_events: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-[var(--border-subtle)]"
                  />
                  <span className="text-[11.5px] text-[var(--text-secondary)]">
                    Also put bookings in it
                  </span>
                </label>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function AvailabilityPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['calendar', 'availability'],
    queryFn: availabilityApi.get,
  });

  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [prefs, setPrefs] = useState<SchedulingPrefs>(DEFAULT_SCHEDULING_PREFS);
  const [dirty, setDirty] = useState(false);

  // Seed the form once the server answers, but never clobber edits in flight.
  useEffect(() => {
    if (!data || dirty) return;
    setWindows(data.windows);
    setPrefs(data.prefs);
  }, [data, dirty]);

  const saveWindows = useMutation({
    mutationFn: (next: AvailabilityWindow[]) => availabilityApi.replaceWindows(next),
    onSuccess: (saved) => {
      // Put the saved week in the cache *before* clearing the edit flag. The
      // seeding effect below fires the moment dirty goes false, and if the
      // cache still held the pre-save week it would put the old hours back on
      // screen until the refetch landed.
      qc.setQueryData(['calendar', 'availability'], (old: AvailabilityResponse | undefined) =>
        (old ? { ...old, windows: saved } : old));
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['calendar'] });
      toast.success('Hours saved');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save those hours'),
  });

  const savePrefs = useMutation({
    mutationFn: (patch: Partial<SchedulingPrefs>) => availabilityApi.updatePrefs(patch),
    onSuccess: (p) => {
      setPrefs(p);
      qc.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that'),
  });

  const byDay = useMemo(() => {
    const m = new Map<number, AvailabilityWindow[]>();
    for (let d = 0; d < 7; d++) m.set(d, []);
    for (const w of windows) m.get(w.weekday)?.push(w);
    for (const list of m.values()) list.sort((a, b) => a.start_minute - b.start_minute);
    return m;
  }, [windows]);

  const edit = (next: AvailabilityWindow[]) => { setWindows(next); setDirty(true); };

  const addWindow = (weekday: number) => {
    const existing = byDay.get(weekday) || [];
    // A new window starts after the last one, so adding twice does not stack
    // two identical rows the database will then refuse.
    const start = existing.length > 0 ? Math.min(existing[existing.length - 1].end_minute + 60, 1380) : 540;
    edit([...windows, { weekday, start_minute: start, end_minute: Math.min(start + 480, 1440) }]);
  };

  const removeWindow = (weekday: number, startMinute: number) =>
    edit(windows.filter((w) => !(w.weekday === weekday && w.start_minute === startMinute)));

  const changeWindow = (weekday: number, startMinute: number, field: 'start_minute' | 'end_minute', value: string) => {
    const parsed = parseMinuteLabel(value);
    if (parsed === null) return;
    edit(windows.map((w) =>
      w.weekday === weekday && w.start_minute === startMinute ? { ...w, [field]: parsed } : w));
  };

  /* ── The preview, straight from the server that would honour it ── */
  const previewRange = useMemo(() => {
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const { data: slots = [], isFetching: previewing } = useQuery({
    queryKey: ['calendar', 'slots', previewRange.from, prefs, dirty],
    queryFn: () => availabilityApi.slots({ ...previewRange, duration: 30 }),
    // Only meaningful once the saved hours are what is on screen.
    enabled: !dirty,
  });

  const zones = useMemo(() => {
    try {
      return (Intl as any).supportedValuesOf?.('timeZone') as string[] ?? [prefs.timezone];
    } catch {
      return [prefs.timezone];
    }
  }, [prefs.timezone]);

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <Clock className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="When people may book you"
        description={describeWeek(windows)}
        actions={
          dirty ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setWindows(data?.windows ?? []); setDirty(false); }}
                className="btn-secondary"
              >
                Discard
              </button>
              <button
                onClick={() => saveWindows.mutate(windows)}
                disabled={saveWindows.isPending}
                className="btn-primary"
              >
                {saveWindows.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save hours
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── The week ── */}
        {/* self-start so the week ends at Sunday rather than stretching to
            match the taller column beside it and leaving a dead white field. */}
        <section className="panel lg:col-span-2 overflow-hidden self-start">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Working hours</h3>
              <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
                Written on your own clock. They stay put when the clocks change.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => edit(p.windows.map((w) => ({ ...w })))}
                  className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--indigo)] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {Array.from({ length: 7 }, (_, i) => (i + 1) % 7).map((weekday) => {
                const list = byDay.get(weekday) || [];
                const off = list.length === 0;
                return (
                  <div key={weekday} data-day={weekday} className="flex items-start gap-3 px-4 py-2.5">
                    <div className="w-[92px] flex-shrink-0 pt-1">
                      <p className={cn(
                        'text-[12.5px] font-medium',
                        off ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]',
                      )}>
                        {WEEKDAY_NAMES[weekday]}
                      </p>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      {off ? (
                        <p className="pt-1 text-[12px] text-[var(--text-tertiary)]">Not available</p>
                      ) : list.map((w) => (
                        /*
                         * Both minutes are in the key on purpose. The time
                         * fields are uncontrolled, so the only thing that can
                         * put a discarded edit back to the saved value is a
                         * remount — and that only happens if the key moves
                         * with whichever end of the window was typed into.
                         */
                        <div key={`${weekday}-${w.start_minute}-${w.end_minute}`} className="flex items-center gap-1.5">
                          <input
                            type="time"
                            defaultValue={minuteLabel(w.start_minute)}
                            onBlur={(e) => changeWindow(weekday, w.start_minute, 'start_minute', e.target.value)}
                            className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12px] tabular text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                          />
                          <span className="text-[11.5px] text-[var(--text-tertiary)]">to</span>
                          <input
                            type="time"
                            defaultValue={minuteLabel(w.end_minute)}
                            onBlur={(e) => changeWindow(weekday, w.start_minute, 'end_minute', e.target.value)}
                            className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12px] tabular text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                          />
                          <button
                            onClick={() => removeWindow(weekday, w.start_minute)}
                            title="Remove this window"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-rose-600 hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => addWindow(weekday)}
                      title={off ? 'Make this day bookable' : 'Add another window (a split day)'}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── The rules ── */}
        <div className="space-y-4">
          <section className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Rules</h3>
              <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">Saved as you change them.</p>
            </div>
            <div className="p-4 space-y-3">
              <Field label="Your timezone" hint="The clock your hours are written against.">
                <div className="relative">
                  <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  <select
                    value={prefs.timezone}
                    onChange={(e) => savePrefs.mutate({ timezone: e.target.value })}
                    className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-7 pr-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                  >
                    {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Gap before" hint="Time to prepare.">
                  <Minutes value={prefs.buffer_before_minutes} options={[0, 5, 10, 15, 30, 60]}
                           onChange={(n) => savePrefs.mutate({ buffer_before_minutes: n })} />
                </Field>
                <Field label="Gap after" hint="Time to write it up.">
                  <Minutes value={prefs.buffer_after_minutes} options={[0, 5, 10, 15, 30, 60]}
                           onChange={(n) => savePrefs.mutate({ buffer_after_minutes: n })} />
                </Field>
              </div>

              <Field label="Least notice" hint="Nobody may book inside this.">
                <Minutes value={prefs.minimum_notice_minutes} options={[0, 60, 120, 240, 480, 1440, 2880]}
                         onChange={(n) => savePrefs.mutate({ minimum_notice_minutes: n })} />
              </Field>

              <Field label="Offer times every" hint="What the offered slots land on.">
                <select
                  value={prefs.slot_interval_minutes}
                  onChange={(e) => savePrefs.mutate({ slot_interval_minutes: Number(e.target.value) })}
                  className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                >
                  {SLOT_INTERVALS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
                </select>
              </Field>

              <Field label="Most per day" hint="A full day, however much space is left.">
                <select
                  value={prefs.max_bookings_per_day ?? ''}
                  onChange={(e) => savePrefs.mutate({
                    max_bookings_per_day: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                >
                  <option value="">No limit</option>
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} a day</option>)}
                </select>
              </Field>

              <Field label="Bookable up to" hint="How far ahead a stranger may reach.">
                <select
                  value={prefs.booking_horizon_days}
                  onChange={(e) => savePrefs.mutate({ booking_horizon_days: Number(e.target.value) })}
                  className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                >
                  {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
                </select>
              </Field>
            </div>
          </section>

          <ExternalCalendars />

          {/* ── What the rules actually produce ── */}
          <section className="panel overflow-hidden" data-preview>
            <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
                <CalendarCheck className="h-3.5 w-3.5 text-[var(--indigo)]" />
                What a 30-minute meeting would be offered
              </h3>
              <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
                The next seven days, from the same place a booking page would ask.
              </p>
            </div>
            <div className="px-4 py-3">
              {dirty ? (
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  Save your hours to see what they offer.
                </p>
              ) : previewing ? (
                <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
                  <Loader2 className="h-3 w-3 animate-spin" /> Working it out…
                </p>
              ) : slots.length === 0 ? (
                <p className="text-[12px] text-[var(--text-secondary)]">
                  {/* The commonest reason is notice, not hours, and it is the
                      one nobody thinks of. */}
                  Nothing in the next seven days. Check your hours, and whether
                  your notice period rules out everything that is left of the week.
                </p>
              ) : (
                <>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)] tabular" data-slot-count>{slots.length}</strong>
                    {' '}slot{slots.length === 1 ? '' : 's'}, first on{' '}
                    <strong className="text-[var(--text-primary)]">
                      {new Date(slots[0].start).toLocaleString(undefined, {
                        weekday: 'short', day: 'numeric', month: 'short',
                        hour: 'numeric', minute: '2-digit',
                      })}
                    </strong>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {slots.slice(0, 12).map((s) => (
                      <span
                        key={s.start}
                        className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] tabular text-[var(--text-secondary)]"
                      >
                        {new Date(s.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ))}
                    {slots.length > 12 && (
                      <span className="px-1 py-0.5 text-[11px] text-[var(--text-tertiary)]">
                        +{slots.length - 12} more
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-[var(--text-secondary)]">{label}</label>
      {hint && <p className="mb-1 text-[10.5px] text-[var(--text-tertiary)]">{hint}</p>}
      {children}
    </div>
  );
}

function Minutes({ value, options, onChange }: {
  value: number; options: number[]; onChange: (n: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
    >
      {options.map((m) => (
        <option key={m} value={m}>{m === 0 ? 'None' : durationLabel(m)}</option>
      ))}
    </select>
  );
}
