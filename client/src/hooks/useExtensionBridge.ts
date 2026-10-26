import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@lemlist/shared';
import { apikeyApi } from '../api/apikey.api';
import { ABSOLUTE_API_URL } from '../lib/constants';

/**
 * Talk to the Chrome extension from an app page.
 *
 * The extension's content script on the app (content/connect.js) answers a
 * ping with SINCERELY_EXTENSION_HERE, and takes a freshly minted key with
 * SINCERELY_EXTENSION_CONNECT. postMessage rather than chrome.runtime,
 * because that needs the extension's id and an unpacked one's changes.
 *
 * `present` only says the extension is installed in this browser; whether
 * it is connected and running is the server's to say (it checks in).
 */
export function useExtensionBridge() {
  const [present, setPresent] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'SINCERELY_EXTENSION_HERE') {
        setPresent(true);
        if (typeof event.data.version === 'string') setVersion(event.data.version);
      }
      if (event.data.type === 'SINCERELY_EXTENSION_CONNECTED') {
        setConnecting(false);
        setResult(event.data.ok ? { ok: true } : { ok: false, error: event.data.error || 'Could not connect the extension' });
      }
    };
    window.addEventListener('message', onMessage);
    // The content script may have announced before this page mounted.
    window.postMessage({ type: 'SINCERELY_EXTENSION_PING' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** Mint a key here and hand it straight to the extension: nothing to copy. */
  const connect = useCallback(async () => {
    setConnecting(true);
    setResult(null);
    try {
      const { raw_key } = await apikeyApi.create({
        name: `Chrome extension (${formatDateTime(new Date())})`,
        rate_limit: 100,
      });
      window.postMessage(
        // Absolute: the extension cannot resolve a relative path.
        { type: 'SINCERELY_EXTENSION_CONNECT', apiKey: raw_key, apiBaseUrl: ABSOLUTE_API_URL },
        window.location.origin,
      );
    } catch (err: any) {
      setConnecting(false);
      setResult({ ok: false, error: err?.response?.data?.error || 'Could not create a key for the extension' });
    }
  }, []);

  return { present, version, connecting, result, connect };
}
