'use strict';

const { url } = require('../lib/http');
const { CONTACT_OUTPUT, decorateContact } = require('../lib/fields');

async function findByEmail(z, email) {
  const response = await z.request({ url: url('/contacts'), params: { email: String(email).trim(), limit: 1 } });
  return ((response.data && response.data.data) || [])[0] || null;
}

module.exports = {
  findByEmail,
  search: {
    key: 'find_contact',
    noun: 'Contact',
    display: { label: 'Find Contact', description: 'Finds a contact by email address.' },
    operation: {
      inputFields: [{ key: 'email', label: 'Email', required: true }],
      perform: async (z, bundle) => {
        const c = await findByEmail(z, bundle.inputData.email);
        return c ? [decorateContact(c)] : [];
      },
      sample: decorateContact({ id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', email: 'ada@analyticalengines.co.uk', first_name: 'Ada', last_name: 'Lovelace', full_name: 'Ada Lovelace', company: 'Analytical Engines', lifecycle: 'lead', email_status: 'valid', tags: ['webinar'], unsubscribed: false, created_at: '2026-11-03T09:41:00.000Z' }),
      outputFields: CONTACT_OUTPUT(),
    },
  },
};
