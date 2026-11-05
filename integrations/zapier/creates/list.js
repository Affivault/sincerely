'use strict';

const { url } = require('../lib/http');

module.exports = {
  key: 'add_to_list',
  noun: 'List Member',
  display: { label: 'Add Contact to List', description: 'Adds a person to a list, creating the contact if the address is new.' },
  operation: {
    inputFields: [
      { key: 'list_id', label: 'List', dynamic: 'list_list.id.name', required: true },
      { key: 'email', label: 'Email', required: true },
    ],
    perform: async (z, bundle) => {
      const { list_id, email } = bundle.inputData;
      const r = (await z.request({ url: url(`/lists/${encodeURIComponent(list_id)}/contacts`), method: 'POST', body: { emails: [String(email).trim()] } })).data || {};
      if ((r.invalid_emails || []).length) throw new z.errors.Error(`"${email}" is not a valid email address.`, 'parameter_invalid', 400);
      return {
        id: `${list_id}:${String(email).trim().toLowerCase()}`,
        list_id,
        email: String(email).trim().toLowerCase(),
        added: r.added > 0,
        already_in_list: r.already_there > 0,
        contact_created: r.created_contacts > 0,
      };
    },
    sample: { id: 'b2d4f6a8-1c3e-4a5b-8c7d-9e0f1a2b3c4d:ada@analyticalengines.co.uk', list_id: 'b2d4f6a8-1c3e-4a5b-8c7d-9e0f1a2b3c4d', email: 'ada@analyticalengines.co.uk', added: true, already_in_list: false, contact_created: false },
    outputFields: [
      { key: 'list_id', label: 'List ID' }, { key: 'email', label: 'Email' },
      { key: 'added', label: 'Added', type: 'boolean' }, { key: 'already_in_list', label: 'Was Already in the List', type: 'boolean' },
      { key: 'contact_created', label: 'New Contact Created', type: 'boolean' },
    ],
  },
};
