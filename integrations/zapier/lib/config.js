'use strict';

/*
 * Where the Sincerely API lives. The live API by default; a self-hosted or
 * staging deployment sets SINCERELY_API_URL with `zapier env:set` (the
 * deploy workflow does this from the repository variable of that name).
 */
const API_ORIGIN = (process.env.SINCERELY_API_URL || 'https://skysend-api.onrender.com').replace(/\/+$/, '').replace(/\/(api\/)?v1$/, '');
const APP_URL = (process.env.SINCERELY_APP_URL || 'https://usesincerely.com').replace(/\/+$/, '');

module.exports = {
  API: `${API_ORIGIN}/v1`,
  APP_URL,
  KEYS_URL: `${APP_URL}/developer?tab=api-keys`,
};
