'use strict';

const { url } = require('./lib/http');
const { KEYS_URL } = require('./lib/config');

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: `Create a key in Sincerely under [Settings > API & webhooks > API keys](${KEYS_URL}). It starts with \`sk_live_\`. Give it both read and write access so every trigger and action works.`,
    },
  ],
  test: async (z) => {
    const response = await z.request({ url: url('/me') });
    const me = response.data;
    const scopes = (me.api_key && me.api_key.scopes) || [];
    if (!scopes.includes('write')) {
      // Triggers need to create webhooks, which is a write.
      throw new z.errors.Error('This API key is read-only. Create one with read and write access for Zapier.', 'insufficient_scope', 403);
    }
    return me;
  },
  connectionLabel: (z, bundle) => {
    const me = bundle.inputData || {};
    const name = me.api_key && me.api_key.name ? ` (${me.api_key.name})` : '';
    return `${me.email || 'Sincerely'}${name}`;
  },
};
