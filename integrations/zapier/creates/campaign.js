'use strict';

const { url } = require('../lib/http');
const { CONTACT_FIELDS, EMAIL_FIELD, TAGS_FIELD, CUSTOM_FIELD, contactBody } = require('../lib/fields');
const { findByEmail } = require('../searches/contact');

/* Why somebody was not added, in words. Mirrors ENROL_SKIP_LABEL in the app. */
const SKIP = {
  already_enrolled: 'already in this campaign',
  in_other_campaign: 'in another active campaign',
  not_in_list: "not in this campaign's lead list",
  suppressed: 'on your suppression list',
  unsubscribed: 'unsubscribed',
  bounced: 'previously bounced',
  no_email: 'no email address',
  not_yours: 'not in this account',
  on_open_deal: 'already on an open deal',
  light_red: 'bad email address (this campaign does not send to red)',
  light_amber: 'risky email address (this campaign does not send to amber)',
  crm_contact_only: 'a CRM contact, not on any lead list',
};

const campaignField = (dynamic) => ({ key: 'campaign_id', label: 'Campaign', dynamic, required: true });

const addToCampaign = {
  key: 'add_to_campaign',
  noun: 'Campaign Contact',
  display: {
    label: 'Add Contact to Campaign',
    description: 'Puts a person into a campaign\'s sequence, creating or updating the contact first. Nobody unsubscribed, suppressed or bounced is ever added.',
  },
  operation: {
    inputFields: [
      campaignField('campaign_list_open.id.name'),
      EMAIL_FIELD,
      ...CONTACT_FIELDS,
      TAGS_FIELD,
      CUSTOM_FIELD,
      { key: 'stop_if_skipped', label: 'Stop the Zap If They Are Not Added?', type: 'boolean', default: 'no', required: false, helpText: 'Yes: later steps only run for people actually added. No: carry on, and use the Outcome field to decide.' },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData;
      const contact = contactBody(input);
      const response = await z.request({
        url: url(`/campaigns/${encodeURIComponent(input.campaign_id)}/contacts`),
        method: 'POST',
        body: { contacts: [contact] },
      });
      const r = response.data || {};
      const skip = (r.skips || [])[0];
      const reasonCode = skip ? skip.reason : Object.keys(r.reasons || {})[0];
      const outcome = r.added > 0 ? 'added' : (r.not_found || []).length ? 'not_found' : 'skipped';
      const reason = outcome === 'added' ? '' : outcome === 'not_found' ? 'not found' : (SKIP[reasonCode] || reasonCode || 'not added');
      const stop = input.stop_if_skipped === true || /^(yes|true)$/i.test(String(input.stop_if_skipped));
      if (outcome !== 'added' && stop) {
        throw new z.errors.HaltedError(`${contact.email} was not added: ${reason}.`);
      }
      return {
        id: `${input.campaign_id}:${contact.email}`,
        campaign_id: input.campaign_id,
        email: contact.email,
        outcome,
        reason,
        reason_code: reasonCode || null,
        detail: skip && skip.detail ? skip.detail : null,
        contact_created: (r.created_contacts || 0) > 0,
        campaign_total: r.total,
      };
    },
    sample: { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e:ada@analyticalengines.co.uk', campaign_id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', email: 'ada@analyticalengines.co.uk', outcome: 'added', reason: '', reason_code: null, detail: null, contact_created: true, campaign_total: 413 },
    outputFields: [
      { key: 'outcome', label: 'Outcome (added, skipped or not_found)' },
      { key: 'reason', label: 'Why Not Added' },
      { key: 'reason_code', label: 'Why Not Added (code)' },
      { key: 'detail', label: 'Detail' },
      { key: 'contact_created', label: 'New Contact Created', type: 'boolean' },
      { key: 'campaign_total', label: 'People in the Campaign Now', type: 'integer' },
      { key: 'email', label: 'Email' },
      { key: 'campaign_id', label: 'Campaign ID' },
    ],
  },
};

const removeFromCampaign = {
  key: 'remove_from_campaign',
  noun: 'Campaign Contact',
  display: { label: 'Remove Contact from Campaign', description: 'Stops a person\'s sequence and takes them out of a campaign.' },
  operation: {
    inputFields: [campaignField('campaign_list.id.name'), { key: 'email', label: 'Email', required: true }],
    perform: async (z, bundle) => {
      const { campaign_id, email } = bundle.inputData;
      const c = await findByEmail(z, email);
      if (!c) throw new z.errors.Error(`There is no contact with the address ${email} in Sincerely.`, 'resource_not_found', 404);
      const response = await z.request({ url: url(`/campaigns/${encodeURIComponent(campaign_id)}/contacts/${c.id}`), method: 'DELETE' });
      return { ...response.data, id: `${campaign_id}:${c.id}`, email: c.email };
    },
    sample: { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e:6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', object: 'enrolment', campaign_id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', contact_id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', email: 'ada@analyticalengines.co.uk', deleted: true },
    outputFields: [{ key: 'campaign_id', label: 'Campaign ID' }, { key: 'contact_id', label: 'Contact ID' }, { key: 'email', label: 'Email' }],
  },
};

const pauseOrResume = (action) => ({
  key: `${action}_campaign`,
  noun: 'Campaign',
  display: {
    label: action === 'pause' ? 'Pause Campaign' : 'Resume Campaign',
    description: action === 'pause' ? 'Stops a campaign sending until it is resumed.' : 'Starts a paused campaign sending again.',
  },
  operation: {
    inputFields: [campaignField('campaign_list.id.name')],
    perform: async (z, bundle) => (await z.request({ url: url(`/campaigns/${encodeURIComponent(bundle.inputData.campaign_id)}/${action}`), method: 'POST' })).data,
    sample: { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', object: 'campaign', name: 'Q4 partnerships', status: action === 'pause' ? 'paused' : 'running' },
    outputFields: [{ key: 'id', label: 'Campaign ID' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }],
  },
});

module.exports = [addToCampaign, removeFromCampaign, pauseOrResume('pause'), pauseOrResume('resume')];
