/* ═══════════════════════════════════════════════════════════════════════
   LinkedIn as a channel.

   There is no public LinkedIn API for connection requests or messages to
   people you aren't connected to, so a LinkedIn step doesn't pretend to
   send anything. It becomes a task — personalised, with the profile one
   click away — and the sequence waits for a human to complete it before
   carrying on.
   ═══════════════════════════════════════════════════════════════════════ */

/** LinkedIn caps a connection-request note at 300 characters. */
export const LINKEDIN_NOTE_MAX = 300;

export const LINKEDIN_STEP_META: Record<string, { label: string; verb: string; hint: string }> = {
  linkedin_connect: {
    label: 'LinkedIn invite',
    verb: 'Send connection request',
    hint: 'A note is optional, and invites without one are accepted more often.',
  },
  linkedin_message: {
    label: 'LinkedIn message',
    verb: 'Send message',
    hint: 'Only reaches people you are already connected to.',
  },
  linkedin_visit: {
    label: 'Profile visit',
    verb: 'View profile',
    hint: 'A visit often earns a look back — the cheapest touch there is.',
  },
};
