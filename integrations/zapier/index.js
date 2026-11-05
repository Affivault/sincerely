'use strict';

const authentication = require('./authentication');
const { addAuth, handleErrors } = require('./lib/http');
const { EVENTS, makeTrigger } = require('./triggers/events');
const dropdowns = require('./triggers/dropdowns');
const createContact = require('./creates/contact');
const campaignActions = require('./creates/campaign');
const addToList = require('./creates/list');
const unsubscribe = require('./creates/unsubscribe');
const findContact = require('./searches/contact').search;
const findCampaign = require('./searches/campaign');

const byKey = (items) => Object.fromEntries(items.map((i) => [i.key, i]));

const triggers = [...EVENTS.map(makeTrigger), ...dropdowns];
const creates = [createContact, ...campaignActions, addToList, unsubscribe];
const searches = [findContact, findCampaign];

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  authentication,
  beforeRequest: [addAuth],
  afterResponse: [handleErrors],

  triggers: byKey(triggers),
  creates: byKey(creates),
  searches: byKey(searches),

  // "Find a contact, or create one if there is none" as one step.
  searchOrCreates: {
    find_contact: {
      key: 'find_contact',
      display: { label: 'Find or Create Contact', description: 'Finds a contact by email, or creates it.' },
      search: 'find_contact',
      create: 'create_contact',
    },
  },
};
