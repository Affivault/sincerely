/* ═══════════════════════════════════════════════════════════════════════
   An IMAP connection that cannot take the server down with it.

   ImapFlow is an EventEmitter. When its socket fails after the await that
   opened it has settled - a server dropping an idle connection, a TLS
   reset, an auth reply arriving after a timeout already won the race - it
   emits 'error'. An 'error' event with no listener is thrown by Node as an
   uncaught exception, and an uncaught exception ends the process.

   None of the six places that opened an IMAP connection listened. So one
   mail server resetting one socket during the five-minutely inbox sync
   restarted the whole API, and every request in flight in every browser
   failed at once - which reached people as "Network Error", at random,
   with nothing in the app to explain it.

   Every ImapFlow is created through this now. The failure it catches has
   already been reported to whoever was awaiting the operation; this only
   stops the echo from killing everything else.
   ═══════════════════════════════════════════════════════════════════════ */

import type { EventEmitter } from 'node:events';

export function guardImap<T extends EventEmitter>(client: T, context: string): T {
  client.on('error', (err: any) => {
    console.warn(`[IMAP:${context}] connection error (contained):`, err?.code || '', err?.message || err);
  });
  return client;
}
