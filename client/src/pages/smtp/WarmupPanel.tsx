import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { smtpApi } from '../../api/smtp.api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Card } from '../../components/shared/Card';
import { cn } from '../../lib/utils';
import { Flame, TrendingUp, Send, Reply, ShieldCheck, Play, Pause, Settings2, Info, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import type { WarmupAccountStatus } from '@lemlist/shared';

function ConfigModal({ account, onClose }: { account: WarmupAccountStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(account.target || 40);
  const [rampDays, setRampDays] = useState(account.ramp_days || 30);
  const [startVolume, setStartVolume] = useState(account.start_volume || 4);

  const save = useMutation({
    mutationFn: () => smtpApi.setWarmup(account.id, {
      enabled: true,
      warmup_daily_target: Number(target),
      warmup_ramp_days: Number(rampDays),
      warmup_start_volume: Number(startVolume),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warmup'] });
      qc.invalidateQueries({ queryKey: ['smtp-accounts'] });
      toast.success(account.warmup_mode ? 'Warm-up updated' : 'Warm-up started');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  return (
    <Modal isOpen onClose={onClose} title={`Warm-up · ${account.from_name || account.email_address}`} size="md">
      <div className="space-y-4">
        <p className="text-[12.5px] text-[var(--text-secondary)]">
          Warm-up ramps this mailbox's real sending volume up gradually while exchanging friendly emails with your other inboxes — building reputation so your campaigns land in the inbox, not spam.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Start / day" type="number" value={String(startVolume)} onChange={(e) => setStartVolume(parseInt(e.target.value) || 1)} hint="Day 1" />
          <Input label="Target / day" type="number" value={String(target)} onChange={(e) => setTarget(parseInt(e.target.value) || 1)} hint="Ramp goal" />
          <Input label="Ramp days" type="number" value={String(rampDays)} onChange={(e) => setRampDays(parseInt(e.target.value) || 1)} hint="To reach target" />
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 px-3 py-2.5 text-[11.5px] text-[var(--text-tertiary)]">
          Campaigns from this mailbox are capped to the current ramp allowance until warm-up completes, so it never spikes.
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : account.warmup_mode ? 'Save changes' : 'Start warm-up'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Send; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
      <span className="text-[12px] font-semibold text-[var(--text-primary)] tabular">{value}</span>
      <span className="text-[11px] text-[var(--text-tertiary)] hidden lg:inline">{label}</span>
    </div>
  );
}

export function WarmupPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['warmup'], queryFn: smtpApi.getWarmup });
  const [config, setConfig] = useState<WarmupAccountStatus | null>(null);

  const pause = useMutation({
    mutationFn: (id: string) => smtpApi.setWarmup(id, { enabled: false }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warmup'] }); qc.invalidateQueries({ queryKey: ['smtp-accounts'] }); toast.success('Warm-up paused'); },
  });

  if (!data || data.accounts.filter((a) => a.is_verified).length === 0) return null;

  const eligible = data.accounts.filter((a) => a.is_verified);
  const lowPool = data.peer_pool < 2;

  return (
    <>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/12"><Flame className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /></span>
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Warm-up</h2>
        <span className="text-[12px] text-[var(--text-tertiary)]">— build reputation before you send at volume</span>
        {data.total_warming > 0 && <span className="ml-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1.5 h-[18px] inline-flex items-center rounded-[4px]">{data.total_warming} warming</span>}
      </div>

      {lowPool && (
        <Card padding="md" className="mb-3">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 text-[var(--indigo)] mt-0.5 flex-shrink-0" />
            <p className="text-[12.5px] text-[var(--text-secondary)]">
              Warm-up works by exchanging real emails between your inboxes. <span className="font-medium text-[var(--text-primary)]">Connect at least 2 verified mailboxes</span> so they can warm each other — the more you connect, the more natural the traffic looks.
            </p>
          </div>
        </Card>
      )}

      <Card padding="none" className="overflow-hidden mb-6">
        {eligible.map((a, i) => {
          const pct = a.ramp_days > 0 ? Math.min(100, Math.round((a.day / a.ramp_days) * 100)) : 0;
          return (
            <div key={a.id} className={cn('p-3.5 flex flex-col sm:flex-row sm:items-center gap-3', i > 0 && 'border-t border-[var(--border-subtle)]')}>
              <div className="min-w-0 sm:w-56 flex items-center gap-2.5">
                <span className={cn('flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0', a.warmup_mode ? 'bg-amber-500/10' : 'bg-[var(--bg-elevated)]')}>
                  {a.complete ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <Flame className={cn('h-4 w-4', a.warmup_mode ? 'text-amber-500' : 'text-[var(--text-muted)]')} />}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{a.from_name || a.label}</p>
                  <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">{a.email_address}</p>
                </div>
              </div>

              {/* Progress */}
              <div className="flex-1 min-w-0">
                {a.warmup_mode ? (
                  <>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-[var(--text-secondary)]">
                        {a.complete ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">Ramp complete · full volume</span> : <>Day {a.day} of {a.ramp_days} · sending up to <span className="font-semibold text-[var(--text-primary)]">{a.allowance}/day</span></>}
                      </span>
                      <span className="text-[var(--text-tertiary)] tabular">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                      <div className={cn('h-full transition-all duration-500', a.complete ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <Metric icon={Send} value={a.sent_7d} label="sent" />
                      <Metric icon={TrendingUp} value={a.received_7d} label="received" />
                      <Metric icon={Reply} value={a.replied_7d} label="replied" />
                    </div>
                  </>
                ) : (
                  <p className="text-[12px] text-[var(--text-tertiary)]">Warm-up is off. Enable it to ramp this mailbox safely.</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {a.warmup_mode ? (
                  <>
                    <button onClick={() => setConfig(a)} className="icon-btn h-7 px-2 text-[11.5px]" title="Configure"><Settings2 className="h-3 w-3" /> Configure</button>
                    <button onClick={() => pause.mutate(a.id)} className="icon-btn h-7 px-2 text-[11.5px]" title="Pause warm-up"><Pause className="h-3 w-3" /> Pause</button>
                  </>
                ) : (
                  <button onClick={() => setConfig(a)} className="icon-btn h-7 px-2.5 text-[11.5px]"><Play className="h-3 w-3" /> Enable warm-up</button>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      {config && <ConfigModal account={config} onClose={() => setConfig(null)} />}
    </>
  );
}
