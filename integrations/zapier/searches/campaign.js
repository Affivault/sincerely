'use strict';

const { url } = require('../lib/http');

module.exports = {
  key: 'find_campaign',
  noun: 'Campaign',
  display: { label: 'Find Campaign', description: 'Finds a campaign by its name (not case sensitive).' },
  operation: {
    inputFields: [{ key: 'name', label: 'Name', required: true }],
    perform: async (z, bundle) => {
      const want = String(bundle.inputData.name || '').trim().toLowerCase();
      let cursor = null;
      // Newest first, at most 1,000 campaigns looked through.
      for (let i = 0; i < 10; i++) {
        const params = { limit: 100 };
        if (cursor) params.cursor = cursor;
        const body = (await z.request({ url: url('/campaigns'), params })).data || {};
        const hit = (body.data || []).find((c) => String(c.name).trim().toLowerCase() === want);
        if (hit) {
          const full = await z.request({ url: url(`/campaigns/${hit.id}`) });
          return [full.data];
        }
        if (!body.has_more || !body.next_cursor) break;
        cursor = body.next_cursor;
      }
      return [];
    },
    sample: { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', object: 'campaign', name: 'Q4 partnerships', status: 'running', list_id: 'b2d4f6a8-1c3e-4a5b-8c7d-9e0f1a2b3c4d', stats: { enrolled: 412, sent: 980, opened: 401, clicked: 57, replied: 38, bounced: 6, unsubscribed: 4 } },
    outputFields: [
      { key: 'id', label: 'Campaign ID' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' },
      { key: 'stats__enrolled', label: 'Enrolled', type: 'integer' }, { key: 'stats__sent', label: 'Sent', type: 'integer' },
      { key: 'stats__replied', label: 'Replied', type: 'integer' },
    ],
  },
};
