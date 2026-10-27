import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FolderOpen, Megaphone, Plus, Check, X } from 'lucide-react';
import { campaignStatusLabel } from '@lemlist/shared';
import { prospectingApi } from '../../api/prospecting.api';
import { listsApi } from '../../api/contacts.api';
import { Button } from '../ui/Button';

const REMEMBER_KEY = 'prospector.listId';

export function rememberedListId(): string {
  try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; }
}

/**
 * Where saved leads go: a lead list (grouped by folder), with the campaigns
 * that list feeds named underneath, because saving into it enrols them.
 * The choice is remembered for the next visit.
 */
export function DestinationPicker({ listId, onChange }: { listId: string; onChange: (id: string) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const { data: destinations } = useQuery({ queryKey: ['prospecting', 'destinations'], queryFn: prospectingApi.destinations });

  useEffect(() => {
    try { localStorage.setItem(REMEMBER_KEY, listId); } catch { /* private mode */ }
  }, [listId]);

  // A remembered list that has since been deleted falls back to no list.
  useEffect(() => {
    if (destinations && listId && !destinations.some((d) => d.id === listId)) onChange('');
  }, [destinations, listId, onChange]);

  const create = useMutation({
    mutationFn: () => listsApi.create({ name: name.trim(), kind: 'lead' }),
    onSuccess: (list) => {
      qc.invalidateQueries({ queryKey: ['prospecting', 'destinations'] });
      qc.invalidateQueries({ queryKey: ['lists'] });
      onChange(list.id);
      setCreating(false);
      setName('');
      toast.success(`Created ${list.name}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not create the list'),
  });

  const chosen = destinations?.find((d) => d.id === listId);
  const byFolder = new Map<string, typeof destinations>();
  for (const d of destinations || []) {
    const key = d.folder || '';
    byFolder.set(key, [...(byFolder.get(key) || []), d]);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <FolderOpen className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <label htmlFor={id} className="text-body text-[var(--text-secondary)]">Save leads to</label>
        {creating ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New list name" aria-label="New list name"
              className="h-8 w-48 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)]" />
            <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}><Check className="h-3 w-3" /> Create</Button>
            <button type="button" aria-label="Cancel" onClick={() => { setCreating(false); setName(''); }} className="icon-btn h-7 w-7"><X className="h-3.5 w-3.5" /></button>
          </form>
        ) : (
          <>
            <select id={id} value={listId} onChange={(e) => onChange(e.target.value)}
              className="h-8 min-w-[220px] max-w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)]">
              <option value="">Leads, no list</option>
              {folders.map((folder) => {
                const options = (byFolder.get(folder) || []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.campaigns.length ? ' · in a campaign' : ''}</option>
                ));
                return folder ? <optgroup key={folder} label={folder}>{options}</optgroup> : options;
              })}
            </select>
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline">
              <Plus className="h-3 w-3" /> New list
            </button>
          </>
        )}
      </div>
      {chosen && (
        chosen.campaigns.length > 0 ? (
          <p className="text-caption text-[var(--text-secondary)] flex items-start gap-1.5">
            <Megaphone className="h-3 w-3 mt-0.5 text-[var(--indigo-text)] flex-shrink-0" />
            <span>
              Saved leads also join{' '}
              {chosen.campaigns.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && (i === chosen.campaigns.length - 1 ? ' and ' : ', ')}
                  <Link to={`/campaigns/${c.id}`} className="font-medium text-[var(--indigo-text)] hover:underline">{c.name}</Link>
                  <span className="text-[var(--text-tertiary)]"> ({campaignStatusLabel(c.status).toLowerCase()})</span>
                </span>
              ))}
              {' '}straight away.
            </span>
          </p>
        ) : (
          <p className="text-caption text-[var(--text-tertiary)]">No campaign uses this list yet. Leads wait in it until you start one.</p>
        )
      )}
    </div>
  );
}
