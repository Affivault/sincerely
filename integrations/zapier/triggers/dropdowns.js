'use strict';

/*
 * Hidden triggers that fill the List and Campaign dropdowns. They walk
 * Sincerely's cursor themselves (up to 1,000, newest first) rather than
 * leaning on Zapier's "load more", so every list shows on the first open.
 */

const { url } = require('../lib/http');

const MAX_PAGES = 10;

async function page(z, bundle, path, filter) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const params = { limit: 100 };
    if (cursor) params.cursor = cursor;
    const body = (await z.request({ url: url(path), params })).data || {};
    out.push(...(body.data || []));
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return out.filter(filter || (() => true));
}

const OPEN = ['draft', 'scheduled', 'running', 'paused'];

const hidden = (key, noun, perform, sample, outputFields) => ({
  key,
  noun,
  display: { label: `List ${noun}s`, description: `Lists ${noun.toLowerCase()}s, for dropdowns.`, hidden: true },
  operation: { type: 'polling', perform, sample, outputFields },
});

const campaignLabel = (c) => `${c.name} (${c.status})`;

module.exports = [
  hidden('list_list', 'List',
    async (z, bundle) => (await page(z, bundle, '/lists')).map((l) => ({ id: l.id, name: `${l.name} (${l.kind === 'contact' ? 'contact list' : 'lead list'}, ${l.contact_count})`, kind: l.kind, contact_count: l.contact_count })),
    { id: 'b2d4f6a8-1c3e-4a5b-8c7d-9e0f1a2b3c4d', name: 'UK partnerships (lead list, 412)', kind: 'lead', contact_count: 412 },
    [{ key: 'id', label: 'List ID' }, { key: 'name', label: 'Name' }]),
  hidden('campaign_list', 'Campaign',
    async (z, bundle) => (await page(z, bundle, '/campaigns')).map((c) => ({ id: c.id, name: campaignLabel(c), status: c.status })),
    { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', name: 'Q4 partnerships (running)', status: 'running' },
    [{ key: 'id', label: 'Campaign ID' }, { key: 'name', label: 'Name' }]),
  // For adding people: a finished campaign cannot take anyone, so it is not offered.
  hidden('campaign_list_open', 'Open Campaign',
    async (z, bundle) => (await page(z, bundle, '/campaigns', (c) => OPEN.includes(c.status))).map((c) => ({ id: c.id, name: campaignLabel(c), status: c.status })),
    { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', name: 'Q4 partnerships (running)', status: 'running' },
    [{ key: 'id', label: 'Campaign ID' }, { key: 'name', label: 'Name' }]),
];
