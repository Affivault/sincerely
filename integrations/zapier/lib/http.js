'use strict';

const { API } = require('./config');

/* Every request: the key, JSON, and a User-Agent that says Zapier, so the
 * request log and the webhook list in Sincerely can name the caller. */
const addAuth = (request, z, bundle) => {
  request.headers = request.headers || {};
  if (bundle.authData && bundle.authData.api_key) {
    request.headers.Authorization = `Bearer ${String(bundle.authData.api_key).trim()}`;
  }
  request.headers['User-Agent'] = 'Zapier (Sincerely app)';
  request.headers.Accept = 'application/json';
  return request;
};

/*
 * Sincerely answers every error as { error: { code, message, param }, request_id }.
 * Turn that into the Zapier error that does the right thing:
 *   401 -> the connection needs reconnecting (ExpiredAuthError)
 *   429 -> try again after Retry-After (ThrottledError)
 *   the rest -> the API's own sentence, which is written for people
 */
const handleErrors = (response, z) => {
  if (response.status < 400 || response.skipThrowForStatus) return response;
  let body = null;
  try { body = response.data !== undefined ? response.data : JSON.parse(response.content); } catch (e) { body = null; }
  const err = body && body.error ? body.error : null;
  const message = err && err.message ? err.message : `Sincerely answered ${response.status}.`;
  const ref = body && body.request_id ? ` (Sincerely reference ${body.request_id})` : '';

  if (response.status === 401) {
    throw new z.errors.ExpiredAuthError(`${message} Reconnect Sincerely with a current API key.`);
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('retry-after')) || 60;
    throw new z.errors.ThrottledError(message, wait);
  }
  throw new z.errors.Error(`${message}${ref}`, err && err.code ? err.code : 'sincerely_error', response.status);
};

const url = (path) => `${API}${path}`;

module.exports = { addAuth, handleErrors, url };
