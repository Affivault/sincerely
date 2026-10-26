import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Chrome, AlertTriangle } from 'lucide-react';
import { linkedinApi } from '../../api/linkedin.api';
import { Notice } from '../ui/Notice';

/* ═══════════════════════════════════════════════════════════════════════
   "LinkedIn agent offline: open Chrome."

   LinkedIn steps are done by the extension in the user's own browser, so
   they only happen while that browser is open. When it is closed nothing
   fails - the steps just wait - and a campaign that is quietly waiting
   looks exactly like a broken one. This says which it is, on the LinkedIn
   page and on any campaign with a LinkedIn step in it.

   The status query is shared with the LinkedIn page, so a campaign page
   showing this costs one small request a minute, and nothing at all for a
   campaign without LinkedIn steps (the caller does not render it).
   ═══════════════════════════════════════════════════════════════════════ */

export function LinkedinAgentNotice({ where = 'page' }: { where?: 'page' | 'campaign' }) {
  const { data } = useQuery({
    queryKey: ['linkedin', 'status'],
    queryFn: linkedinApi.status,
    refetchInterval: 60_000,
    // A database without the agent's migration answers 503; that is the
    // LinkedIn page's to explain, not every campaign's.
    retry: false,
  });
  if (!data) return null;

  const onLinkedinPage = where === 'page';
  const settingsLink = onLinkedinPage ? null : (
    <Link to="/linkedin" className="text-caption font-semibold text-[var(--indigo-text)] hover:underline whitespace-nowrap">
      LinkedIn settings
    </Link>
  );

  if (data.needs_resume && !onLinkedinPage) {
    return (
      <Notice tone="attention" icon={AlertTriangle} title="LinkedIn agent paused: it needs you" action={settingsLink}>
        {data.settings.pause_kind === 'logged_out'
          ? 'LinkedIn is signed out in your browser. Sign in, then resume the agent. LinkedIn steps wait until you do.'
          : 'LinkedIn showed a security check. Clear it in your browser, then resume the agent. LinkedIn steps wait until you do.'}
      </Notice>
    );
  }

  if (!data.settings.enabled) {
    if (onLinkedinPage) return null;
    return (
      <Notice tone="info" icon={Chrome} title="The LinkedIn agent is off" action={settingsLink}>
        This campaign's LinkedIn steps are waiting in Activities for you to do by hand. Turn the agent on and the
        extension does them for you.
      </Notice>
    );
  }

  if (!data.offline) return null;

  return (
    <Notice
      tone="attention"
      icon={Chrome}
      live
      title="LinkedIn agent offline: open Chrome"
      action={settingsLink}
    >
      {data.ever_connected
        ? 'The extension has not checked in for a while, so Chrome is closed or the extension is switched off. LinkedIn steps, reply checks and invite checks wait until it is back. Nothing is lost.'
        : 'The Sincerely extension has never checked in from this account. Install it in Chrome and connect it, and LinkedIn steps start running by themselves.'}
    </Notice>
  );
}
