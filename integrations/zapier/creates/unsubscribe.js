'use strict';

const { url } = require('../lib/http');
const { findByEmail } = require('../searches/contact');

module.exports = {
  key: 'unsubscribe',
  noun: 'Unsubscribe',
  display: {
    label: 'Unsubscribe Contact',
    description: 'Stops every campaign emailing this address, now and in future. Works for addresses that are not contacts yet too.',
  },
  operation: {
    inputFields: [{ key: 'email', label: 'Email', required: true }],
    perform: async (z, bundle) => {
      const email = String(bundle.inputData.email).trim().toLowerCase();
      const c = await findByEmail(z, email);
      if (c) {
        await z.request({ url: url(`/contacts/${c.id}/unsubscribe`), method: 'POST' });
        return { id: email, email, unsubscribed: true, was_contact: true, contact_id: c.id };
      }
      const r = (await z.request({ url: url('/suppressions'), method: 'POST', body: { emails: [email] } })).data || {};
      if ((r.invalid || []).length) throw new z.errors.Error(`"${email}" is not a valid email address.`, 'parameter_invalid', 400);
      return { id: email, email, unsubscribed: true, was_contact: false, contact_id: null };
    },
    sample: { id: 'no-thanks@example.com', email: 'no-thanks@example.com', unsubscribed: true, was_contact: true, contact_id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f' },
    outputFields: [
      { key: 'email', label: 'Email' }, { key: 'unsubscribed', label: 'Unsubscribed', type: 'boolean' },
      { key: 'was_contact', label: 'Was a Contact', type: 'boolean' }, { key: 'contact_id', label: 'Contact ID' },
    ],
  },
};
