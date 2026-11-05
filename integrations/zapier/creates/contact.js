'use strict';

const { url } = require('../lib/http');
const { CONTACT_FIELDS, EMAIL_FIELD, TAGS_FIELD, CUSTOM_FIELD, contactBody, CONTACT_OUTPUT, decorateContact } = require('../lib/fields');

module.exports = {
  key: 'create_contact',
  noun: 'Contact',
  display: {
    label: 'Create or Update Contact',
    description: 'Adds a contact, or updates the one with that email address. Blank fields never clear anything.',
  },
  operation: {
    inputFields: [
      EMAIL_FIELD,
      ...CONTACT_FIELDS,
      { key: 'list_id', label: 'Add to List', dynamic: 'list_list.id.name', required: false, helpText: 'Optional. Adding someone to a contact list makes them a contact rather than a lead.' },
      TAGS_FIELD,
      { key: 'lifecycle', label: 'Lifecycle', required: false, choices: { lead: 'Lead (someone you are prospecting)', contact: 'Contact (a relationship)', customer: 'Customer' }, helpText: 'New contacts are leads unless you choose otherwise. Leave empty to keep an existing contact as they are.' },
      CUSTOM_FIELD,
      { key: 'update_existing', label: 'Update the Contact If the Email Already Exists?', type: 'boolean', default: 'yes', required: false, helpText: 'Yes: fields you filled in are updated. No: the step fails if the email is already in Sincerely.' },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData;
      const body = contactBody(input);
      if (input.list_id) body.list_ids = [input.list_id];
      if (input.lifecycle) body.lifecycle = input.lifecycle;
      // Zapier sends booleans as true/false or "yes"/"no" depending on how the field was set.
      const update = !(input.update_existing === false || /^(no|false)$/i.test(String(input.update_existing)));
      body.upsert = update;
      const response = await z.request({ url: url('/contacts'), method: 'POST', body });
      return decorateContact(response.data);
    },
    sample: decorateContact({ id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', email: 'ada@analyticalengines.co.uk', first_name: 'Ada', last_name: 'Lovelace', full_name: 'Ada Lovelace', company: 'Analytical Engines', lifecycle: 'lead', email_status: 'unverified', tags: ['webinar'], unsubscribed: false, created_at: '2026-11-03T09:41:00.000Z' }),
    outputFields: CONTACT_OUTPUT(),
  },
};
