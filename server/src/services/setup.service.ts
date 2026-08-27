import { supabaseAdmin } from '../config/supabase.js';
import type { SetupState, SetupStep } from '@lemlist/shared';

/**
 * What a new account still has to do.
 *
 * Every answer is read from the database rather than from a flag somebody
 * set when they clicked something. That distinction is the whole design:
 * a checklist that remembers being told "done" will eventually be wrong,
 * and a checklist that is wrong once is never trusted again. This one can
 * only ever describe what is actually there — which also means it copes
 * with someone who did the steps out of order, or in a different session,
 * or on a different device, without any of that being a special case.
 *
 * Counted, never listed: five `head: true` counts and one small select,
 * because this runs on every dashboard load for the whole of an account's
 * first week.
 */
export const setupService = {
  async get(userId: string): Promise<SetupState> {
    const [mailboxes, domains, contacts, campaigns] = await Promise.all([
      supabaseAdmin
        .from('smtp_accounts')
        .select('id, is_active, is_verified, total_sent')
        .eq('user_id', userId),
      supabaseAdmin
        .from('sending_domains')
        .select('id, domain, spf_ok, dkim_ok')
        .eq('user_id', userId),
      supabaseAdmin
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('campaigns')
        .select('id, status')
        .eq('user_id', userId),
    ]);

    const accountRows = mailboxes.data || [];
    const domainRows = domains.data || [];
    const campaignRows = campaigns.data || [];
    const contactCount = contacts.count || 0;
    // Summed from the mailboxes: campaign_activities is scoped by campaign
    // rather than by user, so counting it for one account would mean listing
    // every campaign first for a total the mailboxes already keep.
    const sentCount = accountRows.reduce((n: number, a: any) => n + (Number(a.total_sent) || 0), 0);

    // Connected is not the same as usable: a mailbox that has never passed a
    // connection test will stall a campaign on its first send.
    const activeMailboxes = accountRows.filter((a: any) => a.is_active && a.is_verified);
    const unverifiedMailboxes = accountRows.filter((a: any) => a.is_active && !a.is_verified);
    const verifiedDomains = domainRows.filter((d: any) => d.spf_ok && d.dkim_ok);

    /*
     * A campaign only counts as "built" once it has a step. A campaign row
     * with no steps is a name and nothing else, and treating it as progress
     * would tick the box for someone who opened the builder and left.
     */
    let campaignsWithSteps = 0;
    if (campaignRows.length > 0) {
      const { data: steps } = await supabaseAdmin
        .from('campaign_steps')
        .select('campaign_id')
        .in('campaign_id', campaignRows.map((c: any) => c.id));
      campaignsWithSteps = new Set((steps || []).map((s: any) => s.campaign_id)).size;
    }

    const everLaunched = campaignRows.some((c: any) =>
      ['running', 'scheduled', 'paused', 'completed'].includes(c.status));

    const steps: SetupStep[] = [
      {
        id: 'mailbox',
        label: 'Connect a mailbox',
        detail: 'Sincerely sends from your own address, so replies land in your inbox and your domain builds its own reputation.',
        done: activeMailboxes.length > 0,
        current: false,
        href: '/email-accounts',
        cta: 'Connect',
        progress: activeMailboxes.length > 0
          ? `${activeMailboxes.length} connected`
          : null,
        warning: unverifiedMailboxes.length > 0
          ? `${unverifiedMailboxes.length} mailbox${unverifiedMailboxes.length === 1 ? ' has' : 'es have'} not passed a connection test yet — run "Test" on ${unverifiedMailboxes.length === 1 ? 'it' : 'them'}.`
          : null,
      },
      {
        id: 'domain',
        label: 'Authenticate your domain',
        detail: 'SPF and DKIM are what stop your mail going to spam. Without them a cold campaign mostly does not arrive.',
        done: verifiedDomains.length > 0,
        current: false,
        href: '/email-accounts?tab=domains',
        cta: 'Set up DNS',
        progress: verifiedDomains.length > 0
          ? `${verifiedDomains.length} verified`
          : domainRows.length > 0
            ? `${domainRows.length} added, none verified yet`
            : null,
        warning: domainRows.length > 0 && verifiedDomains.length === 0
          ? 'DNS records can take a few hours to propagate. Re-check if you added them recently.'
          : null,
      },
      {
        id: 'contacts',
        label: 'Add some contacts',
        detail: 'Import a CSV, scrape a site, or add people straight from LinkedIn with the browser extension.',
        done: contactCount > 0,
        current: false,
        href: '/contacts',
        cta: 'Add contacts',
        progress: contactCount > 0 ? `${contactCount.toLocaleString()} contacts` : null,
        warning: null,
      },
      {
        id: 'sequence',
        label: 'Build a sequence',
        detail: 'One email is a message. A sequence with a couple of follow-ups is what actually gets replies.',
        done: campaignsWithSteps > 0,
        current: false,
        href: '/campaigns/new',
        cta: 'Build one',
        progress: campaignsWithSteps > 0
          ? `${campaignsWithSteps} campaign${campaignsWithSteps === 1 ? '' : 's'} ready`
          : campaignRows.length > 0
            ? 'started, no steps yet'
            : null,
        warning: null,
      },
      {
        id: 'launch',
        label: 'Launch it',
        detail: 'We check your setup before anything goes out, so the first send is not the thing that finds the problem.',
        done: everLaunched,
        current: false,
        href: '/campaigns',
        cta: 'Review and launch',
        progress: sentCount > 0 ? `${sentCount.toLocaleString()} sent` : null,
        warning: null,
      },
    ];

    // Exactly one step is the next one. Marking every unfinished step as
    // "current" would be five calls to action and therefore none.
    const next = steps.find((s) => !s.done);
    if (next) next.current = true;

    const doneCount = steps.filter((s) => s.done).length;
    return {
      steps,
      done_count: doneCount,
      complete: doneCount === steps.length,
      fresh: sentCount === 0,
    };
  },
};
