import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Megaphone, X } from 'lucide-react';
import { platformQuery } from '../../lib/platform';
import { cn } from '../../lib/utils';

const DISMISSED = 'sincerely.announcement.dismissed';

function dismissedId(): string | null {
  try { return localStorage.getItem(DISMISSED); } catch { return null; }
}

/* The owners' announcement, on every page until it is closed. A new one shows again. */
export function AnnouncementBanner() {
  const { data } = useQuery(platformQuery);
  const [closed, setClosed] = useState(dismissedId);
  const a = data?.announcement;
  if (!a || closed === a.id) return null;

  const close = () => {
    try { localStorage.setItem(DISMISSED, a.id); } catch { /* private mode: closes for now */ }
    setClosed(a.id);
  };
  const Icon = a.tone === 'warn' ? AlertTriangle : Megaphone;
  const internal = a.link_url?.startsWith('/');

  return (
    <div role="status" className={cn(
      'flex items-center gap-3 px-4 py-2 text-body border-b',
      a.tone === 'warn'
        ? 'bg-amber-500/10 border-amber-500/20 text-amber-900 dark:text-amber-200'
        : 'bg-[var(--indigo-subtle)] border-[var(--border-subtle)] text-[var(--text-primary)]',
    )}>
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <p className="flex-1 min-w-0">
        {a.text}
        {a.link_url && (internal
          ? <> <Link to={a.link_url} className="font-medium underline underline-offset-2">{a.link_label}</Link></>
          : <> <a href={a.link_url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{a.link_label}</a></>)}
      </p>
      <button onClick={close} aria-label="Dismiss" className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
