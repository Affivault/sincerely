'use strict';

/* The contact fields, shared by every action that takes a person. */
const CONTACT_FIELDS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Job Title' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
  { key: 'website', label: 'Website' },
  { key: 'location', label: 'Location', helpText: 'Free text, for example "London, United Kingdom".' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State or Region' },
  { key: 'country', label: 'Country' },
  { key: 'industry', label: 'Industry' },
];

const EMAIL_FIELD = { key: 'email', label: 'Email', required: true, helpText: 'One contact per address. Any case: it is stored lower-case.' };
const TAGS_FIELD = { key: 'tags', label: 'Tags', list: true, helpText: 'Tag names. Ones that do not exist yet are created. On an existing contact this replaces their tags.' };
const CUSTOM_FIELD = { key: 'custom_fields', label: 'Custom Fields', dict: true, helpText: 'Your own fields, as name and value. Merged with any the contact already has.' };

/** Only the contact fields that were actually filled in: blank never clears anything. */
function contactBody(input, { withTags = true, withCustom = true } = {}) {
  const out = {};
  for (const f of [EMAIL_FIELD, ...CONTACT_FIELDS]) {
    const v = input[f.key];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[f.key] = String(v).trim();
  }
  if (withTags && input.tags) {
    const tags = (Array.isArray(input.tags) ? input.tags : String(input.tags).split(','))
      .map((t) => String(t).trim()).filter(Boolean);
    if (tags.length) out.tags = [...new Set(tags)].slice(0, 20);
  }
  if (withCustom && input.custom_fields && typeof input.custom_fields === 'object') {
    const cf = {};
    for (const [k, v] of Object.entries(input.custom_fields)) {
      if (k.trim() && v !== undefined && v !== null && String(v).trim() !== '') cf[k.trim()] = String(v).trim();
    }
    if (Object.keys(cf).length) out.custom_fields = cf;
  }
  return out;
}

/* What a contact looks like on the way out, with labels Zapier shows in the field picker. */
const CONTACT_OUTPUT = (prefix = '') => [
  { key: `${prefix}id`, label: 'Contact ID' },
  { key: `${prefix}email`, label: 'Email' },
  { key: `${prefix}first_name`, label: 'First Name' },
  { key: `${prefix}last_name`, label: 'Last Name' },
  { key: `${prefix}full_name`, label: 'Full Name' },
  { key: `${prefix}company`, label: 'Company' },
  { key: `${prefix}job_title`, label: 'Job Title' },
  { key: `${prefix}phone`, label: 'Phone' },
  { key: `${prefix}linkedin_url`, label: 'LinkedIn URL' },
  { key: `${prefix}website`, label: 'Website' },
  { key: `${prefix}city`, label: 'City' },
  { key: `${prefix}country`, label: 'Country' },
  { key: `${prefix}lifecycle`, label: 'Lifecycle' },
  { key: `${prefix}email_status`, label: 'Email Status' },
  { key: `${prefix}tags_text`, label: 'Tags (comma separated)' },
  { key: `${prefix}engagement_score`, label: 'Engagement Score', type: 'integer' },
  { key: `${prefix}unsubscribed`, label: 'Unsubscribed', type: 'boolean' },
  { key: `${prefix}created_at`, label: 'Created At', type: 'datetime' },
];

/** Adds a comma-joined tags field, which most apps on the other side want instead of a list. */
function decorateContact(c) {
  if (!c || typeof c !== 'object') return c;
  return { ...c, tags_text: Array.isArray(c.tags) ? c.tags.join(', ') : '' };
}

module.exports = { CONTACT_FIELDS, EMAIL_FIELD, TAGS_FIELD, CUSTOM_FIELD, contactBody, CONTACT_OUTPUT, decorateContact };
