import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarClock, Moon, Plus, Star, Trash2, Pencil, X, Check } from 'lucide-react';
import { sendingSchedulesApi, type SendingSchedule, type SendingScheduleInput } from '../../api/sending-schedules.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card } from '../../components/shared/Card';
import { Button } from '../../components/ui/Button';
import { SkeletonList } from '../../components/ui/Skeleton';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { cn } from '../../lib/utils';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const TIMEZONES = [
  'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles',
  'America/Chicago', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/Paris',
];

/** Weekday + HH:MM in a given IANA zone, for the "is this schedule live
 *  right now" indicator below — a schedule's window means nothing at a
 *  glance until it's read against the clock it actually runs on. */
function timePartsInZone(date: Date, timeZone: string): { weekday: string; hhmm: string } | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const parts = fmt.formatToParts(date);
    const weekday = parts.find((p) => p.type === 'weekday')?.value.toLowerCase().slice(0, 3);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    if (!weekday || !hour || !minute) return null;
    return { weekday, hhmm: `${hour}:${minute}` };
  } catch {
    return null;
  }
}

function isSendingNow(schedule: SendingSchedule, now: Date): boolean {
  const parts = timePartsInZone(now, schedule.timezone);
  if (!parts || !schedule.send_days.includes(parts.weekday)) return false;
  const { send_window_start: start, send_window_end: end } = schedule;
  return end < start
    ? (parts.hhmm >= start || parts.hhmm <= end) // overnight window wraps past midnight
    : (parts.hhmm >= start && parts.hhmm <= end);
}

/** What actually happens on delete — matches the server, which promotes the
 *  oldest remaining schedule to default rather than leaving the account with
 *  none (deleting a non-default schedule never changes the default). The old
 *  copy here claimed every deletion "falls back to your default sending
 *  hours," which was backwards for the one case that matters most: deleting
 *  the default itself. */
function deleteWarning(target: SendingSchedule, all: SendingSchedule[]): string {
  if (!target.is_default) {
    return 'Campaigns using this schedule fall back to your default sending hours.';
  }
  const next = all
    .filter((s) => s.id !== target.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return next
    ? `This is your default schedule. Deleting it will make "${next.name}" the new default.`
    : 'This is your only schedule. Deleting it leaves campaigns on the hard-coded default window (09:00-17:00 UTC) until you create a new one.';
}

export function SchedulesPage() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['sending-schedules'],
    queryFn: sendingSchedulesApi.list,
  });

  const [editing, setEditing] = useState<SendingSchedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const createMut = useMutation({
    mutationFn: (input: SendingScheduleInput) => sendingSchedulesApi.create(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sending-schedules'] }); setCreating(false); toast.success('Schedule created'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<SendingScheduleInput> }) => sendingSchedulesApi.update(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sending-schedules'] }); setEditing(null); toast.success('Updated'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => sendingSchedulesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sending-schedules'] }); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  return (
    <div>
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <CalendarClock className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Sending schedules"
        description="Reusable send-time windows. Set one as default to apply automatically to new campaigns."
        meta={schedules.length > 0 ? <span className="tabular">{schedules.length} schedule{schedules.length === 1 ? '' : 's'}</span> : undefined}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New schedule
          </Button>
        }
      />

      {/* List */}
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : schedules.length === 0 && !creating ? (
        <Card padding="lg" className="text-center">
          <div className="mx-auto w-10 h-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center mb-2">
            <CalendarClock className="h-4 w-4 text-[var(--text-tertiary)]" />
          </div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">No schedules yet</h3>
          <p className="text-[12.5px] text-[var(--text-secondary)] mb-3 max-w-md mx-auto">Create a reusable send-time window to apply to campaigns in one click.</p>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Create your first schedule
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {creating && (
            <ScheduleEditor
              onCancel={() => setCreating(false)}
              onSave={(input) => createMut.mutate(input)}
              loading={createMut.isPending}
            />
          )}
          {schedules.map((s) => (
            editing?.id === s.id ? (
              <ScheduleEditor
                key={s.id}
                initial={s}
                onCancel={() => setEditing(null)}
                onSave={(input) => updateMut.mutate({ id: s.id, input })}
                loading={updateMut.isPending}
              />
            ) : (
              <ScheduleCard
                key={s.id}
                schedule={s}
                now={now}
                onEdit={() => setEditing(s)}
                onDelete={() => confirm(
                  { title: `Delete "${s.name}"?`, body: deleteWarning(s, schedules), tone: 'danger' },
                  () => deleteMut.mutate(s.id),
                )}
                onMakeDefault={() => updateMut.mutate({ id: s.id, input: { is_default: true } })}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleCard({ schedule, now, onEdit, onDelete, onMakeDefault }: {
  schedule: SendingSchedule;
  now: Date;
  onEdit: () => void;
  onDelete: () => void;
  onMakeDefault: () => void;
}) {
  const parts = timePartsInZone(now, schedule.timezone);
  const active = isSendingNow(schedule, now);
  return (
    <div className="card card-hover relative overflow-hidden p-4">
      <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', schedule.is_default ? 'bg-[var(--indigo)]' : 'bg-slate-300')} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">{schedule.name}</h3>
            {schedule.is_default && (
              <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-medium bg-[var(--indigo-subtle)] text-[var(--indigo)]">
                <Star className="h-2.5 w-2.5 fill-current" /> Default
              </span>
            )}
            {parts && (
              <span
                title={active ? 'Within this schedule’s send window right now' : 'Outside this schedule’s send window right now'}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-medium',
                  active ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-[var(--text-tertiary)]')} />
                {active ? 'Sending now' : 'Outside window'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[10.5px] text-[var(--text-tertiary)] font-semibold mb-1">Time window</div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)] tabular flex items-center gap-1.5">
                {schedule.send_window_start} – {schedule.send_window_end}
                {schedule.send_window_end < schedule.send_window_start && (
                  <span title="Overnight — wraps past midnight">
                    <Moon className="h-3 w-3 text-[var(--indigo)]" />
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] text-[var(--text-tertiary)] font-semibold mb-1">Timezone</div>
              <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">{schedule.timezone}</div>
              {parts && (
                <div className="text-[11px] text-[var(--text-tertiary)] tabular mt-0.5">{parts.hhmm} there now</div>
              )}
            </div>
            <div>
              <div className="text-[10.5px] text-[var(--text-tertiary)] font-semibold mb-1">Days</div>
              <div className="flex gap-0.5">
                {DAYS.map((d) => (
                  <span key={d.key} className={cn(
                    'w-6 h-6 inline-flex items-center justify-center rounded-md text-[10.5px] font-semibold',
                    schedule.send_days.includes(d.key)
                      ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                  )}>
                    {d.label[0]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          {!schedule.is_default && (
            <button onClick={onMakeDefault} title="Make default" className="icon-btn hover:!text-[var(--indigo)] hover:!bg-[var(--indigo-subtle)]">
              <Star className="h-3 w-3" />
            </button>
          )}
          <button onClick={onEdit} title="Edit" className="icon-btn">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={onDelete} title="Delete" className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleEditor({ initial, onCancel, onSave, loading }: {
  initial?: SendingSchedule;
  onCancel: () => void;
  onSave: (input: SendingScheduleInput) => void;
  loading: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [timezone, setTimezone] = useState(initial?.timezone || 'UTC');
  const [start, setStart] = useState(initial?.send_window_start || '09:00');
  const [end, setEnd] = useState(initial?.send_window_end || '17:00');
  const [days, setDays] = useState<string[]>(initial?.send_days || ['mon', 'tue', 'wed', 'thu', 'fri']);
  const [isDefault, setIsDefault] = useState(initial?.is_default || false);

  const handleSave = () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (days.length === 0) { toast.error('Pick at least one day'); return; }
    if (end === start) { toast.error('End time must be different from start time'); return; }
    onSave({
      name: name.trim(),
      timezone,
      send_window_start: start,
      send_window_end: end,
      send_days: days,
      is_default: isDefault,
    });
  };

  const toggleDay = (key: string) => {
    setDays((curr) => curr.includes(key) ? curr.filter((d) => d !== key) : [...curr, key]);
  };

  return (
    <div className="bg-[var(--bg-surface)] border-2 border-[#6366F1]/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[var(--text-primary)]">{initial ? 'Edit schedule' : 'New schedule'}</h3>
        <button onClick={onCancel} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Business Hours UK"
            className="input-field"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input-field">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Start time</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End time</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="input-field" />
          </div>
        </div>

        {end !== '' && start !== '' && end < start && (
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--indigo)] bg-[var(--indigo-subtle)] rounded-lg px-2.5 py-1.5">
            <Moon className="h-3 w-3 flex-shrink-0" />
            Overnight window — wraps past midnight into the next day
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Days of week</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => toggleDay(d.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  days.includes(d.key)
                    ? 'bg-[var(--indigo)] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
          <span className="text-[var(--text-secondary)]">Set as default — applied to new campaigns automatically</span>
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="btn-primary">
            <Check className="h-4 w-4" /> {loading ? 'Saving...' : (initial ? 'Save changes' : 'Create schedule')}
          </button>
        </div>
      </div>
    </div>
  );
}
