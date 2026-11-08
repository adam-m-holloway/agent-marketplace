// Insights scan: reads each consumer repo's committed .claude/settings.json and records which
// of our plugins it enables, on which channel, at which version.
// Committed intent per repo (from .claude/settings.json), not what each laptop has installed.
//
// Clean-answer rule: `removed` only when the settings file loads without our marketplace/plugin
// or returns 404. 401/403/429/5xx/network errors give `unknown` and keep the previous data.
import { compare, isValid } from '../lib/semver.mjs';

const API = 'https://api.github.com';

class ScanError extends Error {
  constructor(message, http) {
    super(message);
    this.http = http;
  }
}

function makeGetter(fetchFn, token) {
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) cache.set(path, request(fetchFn, token, path));
    return cache.get(path);
  };
}

/** → {status, body}; status 0 on network error. Never throws. */
async function request(fetchFn, token, path) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetchFn(`${API}${path}`, { headers });
  } catch (err) {
    return { status: 0, body: null, error: `network error: ${err.message}` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const remaining = res.headers?.get?.('x-ratelimit-remaining');
  return { status: res.status, body, rateLimited: res.status === 429 || (res.status === 403 && remaining === '0') };
}

function describe(r, path) {
  if (r.status === 0) return `${r.error} (${path})`;
  if (r.status === 401) return `HTTP 401: token invalid or expired (${path})`;
  if (r.rateLimited) return `HTTP ${r.status}: rate limited (${path})`;
  return `HTTP ${r.status} (${path})`;
}

/** 200 → body; 404 → null; anything else throws ScanError. */
async function getOk(get, path) {
  const r = await get(path);
  if (r.status === 200) return r.body;
  if (r.status === 404) return null;
  throw new ScanError(describe(r, path), r.status);
}

function decodeContent(body) {
  return Buffer.from(String(body.content ?? ''), body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}

const key = (r) => `${r.consumer}\u0000${r.plugin}\u0000${r.channel}`;

export function sortRows(rows) {
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function makeRow(fields) {
  const row = {
    date: fields.date,
    consumer: fields.consumer,
    team: fields.team,
    channel: fields.channel,
    marketplace: fields.marketplace,
    plugin: fields.plugin,
    ref: fields.ref ?? null,
    sha: fields.sha ?? null,
    version: fields.version ?? null,
    versions_behind: fields.versions_behind ?? null,
    first_seen: fields.first_seen ?? null,
    status: fields.status,
  };
  if (fields.note) row.note = fields.note;
  return row;
}

/**
 * @returns {Promise<{rows: object[], health: object[]}>}
 * health: one entry per consumer {consumer, team, result: 'ok'|'removed'|'unknown', http, note}
 */
export async function scan({ consumers, marketplaceRepo, channels, fetch: fetchFn, token, today, previous = [] }) {
  const get = makeGetter(fetchFn, token);
  const rows = [];
  const health = [];
  for (const c of consumers) {
    const prev = previous.filter((r) => r.consumer === c.repo);
    try {
      const active = await scanConsumer({ c, get, marketplaceRepo, channels, today, prev });
      const seen = new Set(active.map(key));
      rows.push(...active);
      // Anything we knew about that is no longer enabled → removed (tombstones carry forward).
      for (const p of prev) {
        if (seen.has(key(p))) continue;
        const wasRemoved = p.status === 'removed';
        rows.push(makeRow({ ...p, date: today, status: 'removed', note: wasRemoved ? p.note : `removed on ${today}` }));
      }
      health.push({ consumer: c.repo, team: c.team, result: active.length ? 'ok' : 'removed', http: 200, note: active.length ? '' : 'no enabled plugins from our marketplace' });
    } catch (err) {
      if (!(err instanceof ScanError)) throw err;
      if (err.http === 404) {
        // Settings file gone: a clean answer.
        for (const p of prev) {
          const wasRemoved = p.status === 'removed';
          rows.push(makeRow({ ...p, date: today, status: 'removed', note: wasRemoved ? p.note : `removed on ${today}` }));
        }
        health.push({ consumer: c.repo, team: c.team, result: 'removed', http: 404, note: '.claude/settings.json not found' });
        continue;
      }
      for (const p of prev) {
        // Previous data kept; removed tombstones stay removed (last known state).
        if (p.status === 'removed') rows.push(makeRow({ ...p, date: today }));
        else rows.push(makeRow({ ...p, date: today, status: 'unknown', note: `scan failed: ${err.message}` }));
      }
      health.push({ consumer: c.repo, team: c.team, result: 'unknown', http: err.http, note: err.message });
    }
  }
  return { rows: sortRows(rows), health };
}

async function scanConsumer({ c, get, marketplaceRepo, channels, today, prev }) {
  const settingsPath = `/repos/${c.repo}/contents/.claude/settings.json`;
  const body = await getOk(get, settingsPath);
  if (body === null) throw new ScanError(`HTTP 404 (${settingsPath})`, 404);
  let settings;
  try {
    settings = JSON.parse(decodeContent(body));
  } catch (err) {
    // A file we cannot parse is not a clean "removed" answer.
    throw new ScanError(`invalid JSON in .claude/settings.json: ${err.message}`, 200);
  }

  const byName = new Map(channels.map((ch) => [ch.name, ch]));
  const matched = new Map(); // marketplace name → {channel, ref}
  for (const [name, entry] of Object.entries(settings.extraKnownMarketplaces ?? {})) {
    const ch = byName.get(name);
    if (!ch || entry?.source?.repo !== marketplaceRepo) continue;
    const ref = ch.id === 'latest' ? 'main' : entry.source.ref || ch.ref;
    matched.set(name, { channel: ch, ref });
  }

  const enabled = [];
  for (const [id, on] of Object.entries(settings.enabledPlugins ?? {})) {
    if (on !== true) continue;
    const at = id.lastIndexOf('@');
    if (at <= 0) continue;
    const m = matched.get(id.slice(at + 1));
    if (m) enabled.push({ plugin: id.slice(0, at), marketplace: id.slice(at + 1), ...m });
  }
  if (!enabled.length) return [];

  const commits = await getOk(get, `/repos/${c.repo}/commits?path=.claude/settings.json&per_page=100`);
  const oldest = Array.isArray(commits) && commits.length ? commits[commits.length - 1] : null;
  const firstSeen = (oldest?.commit?.committer?.date ?? oldest?.commit?.author?.date ?? '').slice(0, 10) || null;

  const tags = (await getOk(get, `/repos/${marketplaceRepo}/tags?per_page=100`)) ?? [];
  const out = [];
  for (const e of enabled) {
    const commit = await getOk(get, `/repos/${marketplaceRepo}/commits/${e.ref}`);
    const sha = commit?.sha ?? null;
    let version = null;
    let note;
    if (!sha) note = `ref ${e.ref} not found in ${marketplaceRepo}`;
    else {
      const pj = await getOk(get, `/repos/${marketplaceRepo}/contents/plugins/${e.plugin}/.claude-plugin/plugin.json?ref=${sha}`);
      if (pj) version = JSON.parse(decodeContent(pj)).version ?? null;
      else note = `plugin ${e.plugin} not found at ${e.ref}`;
    }
    let behind = null;
    if (isValid(version)) {
      const prefix = `${e.plugin}--v`;
      behind = tags
        .map((t) => t.name)
        .filter((n) => n.startsWith(prefix) && isValid(n.slice(prefix.length)))
        .filter((n) => compare(n.slice(prefix.length), version) > 0).length;
    }
    const p = prev.find((r) => r.plugin === e.plugin && r.channel === e.channel.id);
    out.push(
      makeRow({
        date: today,
        consumer: c.repo,
        team: c.team,
        channel: e.channel.id,
        marketplace: e.marketplace,
        plugin: e.plugin,
        ref: e.ref,
        sha,
        version,
        versions_behind: behind,
        first_seen: firstSeen ?? p?.first_seen ?? null,
        status: 'active',
        note,
      }),
    );
  }
  return out;
}

/**
 * Events between the previous day's snapshot and today's, keyed consumer+plugin+channel.
 * `unknown` today → no event (we don't know). `unknown` yesterday counts as last-known present.
 */
export function diffEvents(previousRows, todayRows) {
  const present = (r) => r && (r.status === 'active' || r.status === 'unknown');
  const prev = new Map(previousRows.map((r) => [key(r), r]));
  const events = [];
  for (const t of sortRows(todayRows)) {
    if (t.status === 'unknown') continue;
    const p = prev.get(key(t));
    const base = { date: t.date, consumer: t.consumer, team: t.team, channel: t.channel, plugin: t.plugin };
    if (t.status === 'active' && !present(p)) {
      events.push({ ...base, type: 'added', from_version: null, to_version: t.version });
    } else if (t.status === 'active' && p.version !== t.version) {
      events.push({ ...base, type: 'version_changed', from_version: p.version, to_version: t.version });
    } else if (t.status === 'removed' && present(p)) {
      events.push({ ...base, type: 'removed', from_version: p.version, to_version: null });
    }
  }
  // Stable key order for NDJSON output.
  return events.map((e) => ({
    date: e.date, type: e.type, consumer: e.consumer, team: e.team, channel: e.channel,
    plugin: e.plugin, from_version: e.from_version, to_version: e.to_version,
  }));
}
