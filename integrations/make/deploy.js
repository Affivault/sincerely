'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   Uploads the Sincerely app (app/definition.js) into a custom app in Make,
   through Make's SDK API: the same calls Make's own Apps Editor makes
   (github.com/integromat/vscode-apps-sdk, local-development/*).

     sections:   PUT  {base}/{app}/{version}/base | common | groups
     connection: POST {base}/{app}/connections            (Make names it)
                 PUT  {base}/connections/{name}/api | parameters
     webhooks:   POST {base}/{app}/webhooks               (Make names them)
                 PUT  {base}/webhooks/{name}/api | parameters | attach | detach
     rpcs:       POST {base}/{app}/{version}/rpcs
                 PUT  {base}/{app}/{version}/rpcs/{name}/api | parameters
     modules:    POST {base}/{app}/{version}/modules
                 PATCH / PUT .../modules/{name} and its sections

   Safe to run again and again: components are found by name (or, for the
   connection and webhooks Make names itself, by label) and updated in
   place, never duplicated.

   Settings (environment):
     MAKE_API_TOKEN   a Make API token with the sdk-apps scopes
     MAKE_ZONE        where the Make organisation lives: eu1.make.com, us1.make.com, ...
     MAKE_APP_ID      the custom app's name in Make, e.g. sincerely-a1b2c3
     MAKE_APP_VERSION the app's major version (default 1)
     SINCERELY_API_URL the Sincerely API origin (default the live one)

   Run: node deploy.js [--dry-run]
   ═══════════════════════════════════════════════════════════════════════ */

const app = require('./app/definition');

const MODULE_TYPE_ID = { trigger: 1, action: 4, search: 9, instant_trigger: 10, responder: 11, universal: 12 };
const JSONC = 'application/jsonc';
const JSON_TYPE = 'application/json';

function settings(env = process.env) {
  const missing = ['MAKE_API_TOKEN', 'MAKE_ZONE', 'MAKE_APP_ID'].filter((k) => !String(env[k] || '').trim());
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
  const zone = String(env.MAKE_ZONE).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.(make\.com|celonis\.com)$/i.test(zone) && !env.MAKE_ALLOW_ANY_ZONE) {
    throw new Error(`MAKE_ZONE should look like eu1.make.com or us1.make.com, not "${env.MAKE_ZONE}".`);
  }
  const version = Number(env.MAKE_APP_VERSION || 1);
  if (!Number.isInteger(version) || version < 1) throw new Error('MAKE_APP_VERSION must be a whole number, usually 1.');
  return {
    sdk: `${env.MAKE_BASE_URL || `https://${zone}`}/api/v2/sdk/apps`,
    token: String(env.MAKE_API_TOKEN).trim(),
    appId: String(env.MAKE_APP_ID).trim(),
    version,
    apiOrigin: env.SINCERELY_API_URL || app.DEFAULT_API,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(cfg, { dryRun = false, log = console.log } = {}) {
  let calls = 0;
  async function call(method, url, { json, text, contentType } = {}) {
    if (dryRun && method !== 'GET') {
      log(`  would ${method} ${url.replace(cfg.sdk, '')}`);
      return {};
    }
    for (let attempt = 1; ; attempt++) {
      calls++;
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Token ${cfg.token}`,
          Accept: 'application/json',
          ...(json !== undefined ? { 'Content-Type': JSON_TYPE } : {}),
          ...(text !== undefined ? { 'Content-Type': contentType } : {}),
        },
        body: json !== undefined ? JSON.stringify(json) : text,
      });
      const raw = await res.text();
      // Make limits API calls per minute; wait and try again rather than fail half way.
      if (res.status === 429 && attempt < 6) {
        await sleep(Math.min(60, Number(res.headers.get('retry-after')) || 5 * attempt) * 1000);
        continue;
      }
      if (!res.ok) {
        let detail = raw.slice(0, 600);
        try { const b = JSON.parse(raw); detail = [b.message, b.detail, ...(b.suberrors || []).map((s) => s.message)].filter(Boolean).join(' - ') || detail; } catch { /* not JSON */ }
        const hint = res.status === 401 ? ' The API token is wrong or expired.'
          : res.status === 403 ? ' The API token is missing the sdk-apps scopes, or cannot see this app.'
            : res.status === 404 && /\/sdk\/apps\/[^/]+\/\d+$/.test(url) ? ' Check MAKE_APP_ID and MAKE_ZONE.' : '';
        throw new Error(`${method} ${url.replace(cfg.sdk, '')} answered ${res.status}: ${detail}.${hint}`);
      }
      if (!raw) return {};
      try { return JSON.parse(raw); } catch { return {}; }
    }
  }
  return { call, count: () => calls };
}

const iml = (v) => `${JSON.stringify(v, null, 2)}\n`;

async function deploy(cfg, opts = {}) {
  const log = opts.log || console.log;
  const { call, count } = client(cfg, opts);
  const A = `${cfg.sdk}/${encodeURIComponent(cfg.appId)}`;
  const V = `${A}/${cfg.version}`;
  const put = (url, value, contentType = JSONC) => call('PUT', url, { text: contentType === JSONC ? iml(value) : JSON.stringify(value), contentType });
  const summary = { created: [], updated: [] };

  // The app must exist: it is made once in Make's web interface.
  const appInfo = await call('GET', V);
  log(`Deploying to ${appInfo.app ? `"${appInfo.app.label}" (${cfg.appId} v${cfg.version})` : `${cfg.appId} v${cfg.version}`}`);

  const live = app.forApi(cfg.apiOrigin);
  log(`App: base and common (API at ${live.common.apiUrl})`);
  await put(`${V}/base`, live.base);
  await put(`${V}/common`, live.common, JSON_TYPE);

  // Connection: Make names it, so it is found by label.
  log('Connection');
  const connections = (await call('GET', `${A}/connections`)).appConnections || [];
  let conn = connections.find((c) => c.label === live.connection.label && c.type === live.connection.type);
  if (!conn) {
    const made = await call('POST', `${A}/connections`, { json: { label: live.connection.label, type: live.connection.type } });
    conn = made.appConnection || { name: '(dry run)' };
    summary.created.push(`connection ${conn.name}`);
  } else summary.updated.push(`connection ${conn.name}`);
  const C = `${cfg.sdk}/connections/${encodeURIComponent(conn.name)}`;
  await put(`${C}/api`, live.connection.api);
  await put(`${C}/parameters`, live.connection.parameters);

  // Webhooks: Make names them too; each one's label is unique.
  log(`Webhooks (${app.webhooks.length})`);
  const hooks = (await call('GET', `${A}/webhooks`)).appWebhooks || [];
  const hookName = {};
  for (const w of app.webhooks) {
    let hook = hooks.find((h) => h.label === w.label);
    if (!hook) {
      const made = await call('POST', `${A}/webhooks`, { json: { label: w.label, type: w.type, connection: conn.name } });
      hook = made.appWebhook || { name: `(dry run ${w.key})` };
      summary.created.push(`webhook ${hook.name}`);
    } else {
      await call('PATCH', `${cfg.sdk}/webhooks/${encodeURIComponent(hook.name)}`, { json: { label: w.label, connection: conn.name } });
      summary.updated.push(`webhook ${hook.name}`);
    }
    hookName[w.key] = hook.name;
    const W = `${cfg.sdk}/webhooks/${encodeURIComponent(hook.name)}`;
    await put(`${W}/api`, w.api);
    await put(`${W}/parameters`, w.parameters);
    await put(`${W}/attach`, w.attach);
    await put(`${W}/detach`, w.detach);
  }

  // RPCs: named by us.
  log(`RPCs (${app.rpcs.length})`);
  const rpcs = (await call('GET', `${V}/rpcs`)).appRpcs || [];
  for (const r of app.rpcs) {
    if (!rpcs.some((x) => x.name === r.key)) {
      await call('POST', `${V}/rpcs`, { json: { name: r.key, label: r.label, connection: conn.name } });
      summary.created.push(`rpc ${r.key}`);
    } else {
      await call('PATCH', `${V}/rpcs/${r.key}`, { json: { label: r.label, connection: conn.name } });
      summary.updated.push(`rpc ${r.key}`);
    }
    await put(`${V}/rpcs/${r.key}/api`, r.api);
    await put(`${V}/rpcs/${r.key}/parameters`, r.parameters);
  }

  // Modules: named by us.
  log(`Modules (${app.modules.length})`);
  const modules = (await call('GET', `${V}/modules`)).appModules || [];
  for (const m of app.modules) {
    const typeId = MODULE_TYPE_ID[m.moduleType];
    const existing = modules.find((x) => x.name === m.key);
    const meta = {
      label: m.label,
      description: m.description,
      connection: conn.name,
      ...(m.webhook ? { webhook: hookName[m.webhook] } : {}),
      ...(m.crud ? { crud: m.crud } : {}),
    };
    if (existing && existing.typeId !== undefined && existing.typeId !== typeId) {
      throw new Error(`Module ${m.key} exists in Make as type ${existing.typeId}, but is type ${typeId} here. Make cannot change a module's type: delete it in Make and run this again.`);
    }
    if (!existing) {
      await call('POST', `${V}/modules`, {
        json: { name: m.key, typeId, moduleInitMode: 'blank', ...(m.moduleType === 'universal' ? { subtype: 'Universal' } : {}), ...meta },
      });
      summary.created.push(`module ${m.key}`);
    } else {
      await call('PATCH', `${V}/modules/${m.key}`, { json: meta });
      summary.updated.push(`module ${m.key}`);
    }
    const M = `${V}/modules/${m.key}`;
    await put(`${M}/api`, m.api);
    await put(`${M}/parameters`, m.parameters);
    await put(`${M}/expect`, m.expect);
    await put(`${M}/interface`, m.interface);
    await put(`${M}/samples`, m.samples);
  }

  // Groups last: they name modules, which now all exist.
  log('Groups');
  await put(`${V}/groups`, app.groups, JSON_TYPE);

  log(`Done: ${summary.created.length} created, ${summary.updated.length} updated, ${count()} API calls.`);
  return summary;
}

module.exports = { deploy, settings, MODULE_TYPE_ID };

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  let cfg;
  try { cfg = settings(); } catch (e) { console.error(e.message); process.exit(2); }
  deploy(cfg, { dryRun }).catch((e) => { console.error(`\nDeploy failed: ${e.message}`); process.exit(1); });
}
