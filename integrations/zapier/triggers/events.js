'use strict';

/*
 * Instant triggers, one per Sincerely event. Each is a REST hook: turning
 * the Zap on creates a webhook in Sincerely for exactly that event, and
 * turning it off deletes it. Deliveries arrive within seconds, with the
 * whole contact and campaign, so nothing has to be looked up afterwards.
 */

const { url } = require('../lib/http');
const { CONTACT_OUTPUT, decorateContact } = require('../lib/fields');

/** The event, shaped for Zapier: a stable id, and the parts named plainly. */
function shape(event) {
  const data = (event && event.data) || {};
  const out = {
    id: event.id,
    event_type: event.type,
    occurred_at: event.created_at,
  };
  if (data.contact) out.contact = decorateContact(data.contact);
  if (data.campaign) out.campaign = data.campaign;
  if (data.reply) out.reply = data.reply;
  if (data.email) out.email = data.email;
  if (data.reason !== undefined) out.reason = data.reason;
  if (data.source !== undefined) out.source = data.source;
  return out;
}

const CAMPAIGN_FILTER = {
  key: 'campaign_id',
  label: 'Campaign',
  dynamic: 'campaign_list.id.name',
  required: false,
  helpText: 'Only for this campaign. Leave empty for every campaign.',
};

const REPLY_OUTPUT = [
  { key: 'reply__id', label: 'Reply ID' },
  { key: 'reply__from_email', label: 'Reply From Email' },
  { key: 'reply__from_name', label: 'Reply From Name' },
  { key: 'reply__subject', label: 'Reply Subject' },
  { key: 'reply__text', label: 'Reply Text' },
  { key: 'reply__intent', label: 'Reply Intent (interested, meeting, objection, ...)' },
  { key: 'reply__intent_confidence', label: 'Reply Intent Confidence (0-1)', type: 'number' },
  { key: 'reply__received_at', label: 'Reply Received At', type: 'datetime' },
];

const CAMPAIGN_OUTPUT = [
  { key: 'campaign__id', label: 'Campaign ID' },
  { key: 'campaign__name', label: 'Campaign Name' },
  { key: 'campaign__status', label: 'Campaign Status' },
];

/** [key, event, noun, label, description, campaign filter, extra output] */
const EVENTS = [
  ['reply_interested', 'reply.interested', 'Interested Reply', 'New Interested Reply',
    'Triggers when Relay reads a reply as interested or asking for a meeting. The one most teams want.', true, REPLY_OUTPUT],
  ['reply_received', 'reply.received', 'Reply', 'New Reply',
    'Triggers when a contact replies to a campaign email (out-of-office and auto-replies are left out).', true, REPLY_OUTPUT],
  ['reply_classified', 'reply.classified', 'Classified Reply', 'Reply Classified',
    'Triggers when Relay has read a reply, whatever it found: interested, meeting, objection, not now, unsubscribe and so on.', true, REPLY_OUTPUT],
  ['contact_created', 'contact.created', 'Contact', 'New Contact',
    'Triggers when a contact is added, by hand, import, the Prospector, the API or another integration.', false, []],
  ['contact_updated', 'contact.updated', 'Contact', 'Updated Contact',
    'Triggers when a contact\'s details change.', false, []],
  ['contact_unsubscribed', 'contact.unsubscribed', 'Unsubscribe', 'Contact Unsubscribed',
    'Triggers when a contact unsubscribes, by the link in an email or a reply Relay reads as one.', true, []],
  ['email_opened', 'email.opened', 'Open', 'Email Opened',
    'Triggers when a campaign email is opened.', true, [{ key: 'email__step_id', label: 'Step ID' }]],
  ['email_clicked', 'email.clicked', 'Click', 'Link Clicked',
    'Triggers when a link in a campaign email is clicked.', true, [{ key: 'email__url', label: 'Clicked URL' }, { key: 'email__step_id', label: 'Step ID' }]],
  ['email_bounced', 'email.bounced', 'Bounce', 'Email Bounced',
    'Triggers when a campaign email bounces.', true, [{ key: 'email__kind', label: 'Bounce Kind' }, { key: 'email__reason', label: 'Bounce Reason' }]],
  ['email_sent', 'email.sent', 'Sent Email', 'Email Sent',
    'Triggers when a campaign email goes out. Can be a lot of tasks on a busy account.', true, [{ key: 'email__subject', label: 'Subject' }, { key: 'email__step_id', label: 'Step ID' }]],
  ['campaign_completed', 'campaign.completed', 'Campaign', 'Campaign Completed',
    'Triggers when every contact in a campaign has finished its sequence.', false, []],
  ['campaign_paused', 'campaign.paused', 'Campaign', 'Campaign Paused',
    'Triggers when a campaign is paused, by a person or by the deliverability autopilot.', false, [{ key: 'reason', label: 'Why It Was Paused' }]],
];

function makeTrigger([key, type, noun, label, description, campaignFilter, extraOutput]) {
  const hasContact = !type.startsWith('campaign.');
  return {
    key,
    noun,
    display: { label, description },
    operation: {
      type: 'hook',
      inputFields: campaignFilter ? [CAMPAIGN_FILTER] : [],

      performSubscribe: async (z, bundle) => {
        const response = await z.request({
          url: url('/webhooks'),
          method: 'POST',
          body: { url: bundle.targetUrl, events: [type], description: `Zapier: ${label}` },
        });
        return response.data;
      },

      performUnsubscribe: async (z, bundle) => {
        const id = bundle.subscribeData && bundle.subscribeData.id;
        if (!id) return {};
        // Already gone (deleted in Sincerely, or switched off by a 410) is fine.
        const response = await z.request({ url: url(`/webhooks/${encodeURIComponent(id)}`), method: 'DELETE', skipThrowForStatus: true });
        if (response.status >= 400 && response.status !== 404) response.throwForStatus();
        return response.data || {};
      },

      perform: async (z, bundle) => {
        const event = bundle.cleanedRequest || {};
        if (!event.type || event.type !== type) return [];
        const out = shape(event);
        const only = bundle.inputData && bundle.inputData.campaign_id;
        if (only && (!out.campaign || out.campaign.id !== only)) return [];
        return [out];
      },

      // Shown while setting up the Zap: built from this account's own latest data where there is some.
      performList: async (z, bundle) => {
        const response = await z.request({ url: url(`/events/types/${encodeURIComponent(type)}/sample`) });
        return [shape(response.data)];
      },

      sample: shape({
        id: 'evt_9b2f6c1e8a4d4e0f',
        type,
        created_at: '2026-11-03T09:41:00.000Z',
        data: {
          ...(hasContact ? { contact: { id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', email: 'ada@analyticalengines.co.uk', first_name: 'Ada', last_name: 'Lovelace', full_name: 'Ada Lovelace', company: 'Analytical Engines', job_title: 'Head of Partnerships', lifecycle: 'lead', email_status: 'valid', tags: ['webinar'], unsubscribed: type === 'contact.unsubscribed', created_at: '2026-11-03T09:41:00.000Z' } } : {}),
          campaign: { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', name: 'Q4 partnerships', status: 'running' },
          ...(type.startsWith('reply.') ? { reply: { id: 'f6b8d0e2-5a7c-4e9f-8a1b-3c4d5e6f7a8b', from_email: 'ada@analyticalengines.co.uk', from_name: 'Ada Lovelace', subject: 'Re: partnering with Analytical Engines', text: 'Thanks - this is timely. Could we talk on Thursday?', intent: type === 'reply.received' ? null : 'meeting', intent_confidence: type === 'reply.received' ? null : 0.94, received_at: '2026-11-03T09:41:00.000Z' } } : {}),
        },
      }),

      outputFields: [
        { key: 'id', label: 'Event ID' },
        { key: 'event_type', label: 'Event Type' },
        { key: 'occurred_at', label: 'Occurred At', type: 'datetime' },
        ...(hasContact ? CONTACT_OUTPUT('contact__') : []),
        ...CAMPAIGN_OUTPUT,
        ...extraOutput,
      ],
    },
  };
}

module.exports = { EVENTS, makeTrigger, shape };
