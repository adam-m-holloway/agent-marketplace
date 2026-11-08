import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scan, diffEvents } from '../scripts/insights/scan.mjs';
import { CHANNELS, REPO } from '../scripts/lib/plugins.mjs';
import { CONSUMERS, loadFixtures, fixtureFetch } from './fixtures/insights/fixture-fetch.mjs';

const run = (fixtures, { today = '2026-11-09', previous = [], consumers = CONSUMERS } = {}) =>
  scan({ consumers, marketplaceRepo: REPO, channels: CHANNELS, fetch: fixtureFetch(loadFixtures('marketplace', ...fixtures)), token: 't', today, previous });

const find = (rows, consumer, plugin) => rows.find((r) => r.consumer === `adam-m-holloway/${consumer}` && r.plugin === plugin);

test('latest consumer: resolves main → sha → version, behind 0, first_seen = oldest settings commit', async () => {
  const { rows, health } = await run(['team-a', 'team-b']);
  assert.deepEqual(find(rows, 'team-a', 'adr-helper'), {
    date: '2026-11-09', consumer: 'adam-m-holloway/team-a', team: 'team-a', channel: 'latest',
    marketplace: 'agent-marketplace', plugin: 'adr-helper', ref: 'main', sha: 'a1'.repeat(20),
    version: '1.1.0', versions_behind: 0, first_seen: '2026-11-08', status: 'active',
  });
  // Disabled plugins and other marketplaces are ignored.
  assert.deepEqual(rows.filter((r) => r.consumer.endsWith('team-a')).map((r) => r.plugin), ['adr-helper', 'go-conventions']);
  assert.ok(health.every((h) => h.result === 'ok'));
});

test('stable consumer: resolves source.ref stable → 1.0.0, 1 version behind', async () => {
  const { rows } = await run(['team-a', 'team-b']);
  const r = find(rows, 'team-b', 'adr-helper');
  assert.equal(r.channel, 'stable');
  assert.equal(r.marketplace, 'agent-marketplace-stable');
  assert.equal(r.ref, 'stable');
  assert.equal(r.sha, 'b2'.repeat(20));
  assert.equal(r.version, '1.0.0');
  assert.equal(r.versions_behind, 1);
  assert.equal(r.first_seen, '2026-11-08');
  assert.equal(find(rows, 'team-b', 'typescript-conventions').versions_behind, 0);
});

test('removed plugin: settings lacks it → removed row + removed event', async () => {
  const day1 = (await run(['team-a', 'team-b'], { today: '2026-11-08' })).rows;
  const { rows } = await run(['team-a', 'team-b-without-ts'], { previous: day1 });
  const ts = find(rows, 'team-b', 'typescript-conventions');
  assert.equal(ts.status, 'removed');
  assert.equal(ts.note, 'removed on 2026-11-09');
  assert.equal(ts.version, '1.0.0', 'last known data kept on the tombstone');
  assert.equal(find(rows, 'team-b', 'adr-helper').status, 'active');
  assert.deepEqual(diffEvents(day1, rows), [{
    date: '2026-11-09', type: 'removed', consumer: 'adam-m-holloway/team-b', team: 'team-b', channel: 'stable',
    plugin: 'typescript-conventions', from_version: '1.0.0', to_version: null,
  }]);
  // Restoring it the next day → active again + added event.
  const day3 = (await run(['team-a', 'team-b'], { today: '2026-11-10', previous: rows })).rows;
  assert.equal(find(day3, 'team-b', 'typescript-conventions').status, 'active');
  assert.deepEqual(diffEvents(rows, day3).map((e) => [e.type, e.plugin]), [['added', 'typescript-conventions']]);
});

test('404 settings → previous rows become removed (clean answer)', async () => {
  const day1 = (await run(['team-a', 'team-b'], { today: '2026-11-08' })).rows;
  const { rows, health } = await run(['team-a', 'team-b-404'], { previous: day1 });
  const b = rows.filter((r) => r.consumer.endsWith('team-b'));
  assert.equal(b.length, 2);
  assert.ok(b.every((r) => r.status === 'removed'));
  assert.equal(health.find((h) => h.team === 'team-b').result, 'removed');
  assert.deepEqual(diffEvents(day1, rows).map((e) => e.type), ['removed', 'removed']);
});

for (const code of ['403', '500', '401']) {
  test(`${code} settings → unknown, previous data kept, no events`, async () => {
    const day1 = (await run(['team-a', 'team-b'], { today: '2026-11-08' })).rows;
    const { rows, health } = await run(['team-a', `team-b-${code}`], { previous: day1 });
    const b = rows.filter((r) => r.consumer.endsWith('team-b'));
    const before = day1.filter((r) => r.consumer.endsWith('team-b'));
    assert.equal(b.length, 2);
    for (const r of b) {
      assert.equal(r.status, 'unknown');
      assert.match(r.note, new RegExp(`HTTP ${code}`));
      const { date, status, note, ...data } = r;
      const old = before.find((o) => o.plugin === r.plugin);
      const { date: d0, status: s0, ...oldData } = old;
      assert.deepEqual(data, oldData);
    }
    const h = health.find((x) => x.team === 'team-b');
    assert.equal(h.result, 'unknown');
    if (code === '401') assert.match(h.note, /token invalid or expired/);
    assert.deepEqual(diffEvents(day1, rows), []);
  });
}

test('network error → unknown', async () => {
  const day1 = (await run(['team-a', 'team-b'], { today: '2026-11-08' })).rows;
  const fetch = async () => { throw new Error('ECONNRESET'); };
  const { rows, health } = await scan({ consumers: CONSUMERS, marketplaceRepo: REPO, channels: CHANNELS, fetch, token: 't', today: '2026-11-09', previous: day1 });
  assert.ok(rows.every((r) => r.status === 'unknown'));
  assert.ok(health.every((h) => h.result === 'unknown' && /network error/.test(h.note)));
});

test('MUTATE: flipping the 403 fixture to 404 turns unknown into removed', async () => {
  const day1 = (await run(['team-a', 'team-b'], { today: '2026-11-08' })).rows;
  const map = loadFixtures('marketplace', 'team-a', 'team-b-403');
  const settings = '/repos/adam-m-holloway/team-b/contents/.claude/settings.json';
  const go = (m) => scan({ consumers: CONSUMERS, marketplaceRepo: REPO, channels: CHANNELS, fetch: fixtureFetch(m), token: 't', today: '2026-11-09', previous: day1 });
  const as403 = (await go(map)).rows;
  assert.equal(find(as403, 'team-b', 'adr-helper').status, 'unknown');
  const mutated = { ...map, [settings]: { ...map[settings], status: 404 } };
  const as404 = (await go(mutated)).rows;
  assert.equal(find(as404, 'team-b', 'adr-helper').status, 'removed');
});

test('version change between days → version_changed event', async () => {
  const prev = (await run(['team-a', 'team-b'], { today: '2026-11-08' })).rows.map((r) =>
    r.consumer.endsWith('team-a') && r.plugin === 'adr-helper' ? { ...r, version: '1.0.0' } : r);
  const { rows } = await run(['team-a', 'team-b'], { previous: prev });
  assert.deepEqual(diffEvents(prev, rows).map((e) => [e.type, e.plugin, e.from_version, e.to_version]), [['version_changed', 'adr-helper', '1.0.0', '1.1.0']]);
});

test('rows match schema/consumers.schema.json keys', async () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/consumers.schema.json', import.meta.url), 'utf8'));
  const { rows } = await run(['team-a', 'team-b']);
  for (const r of rows) {
    for (const k of schema.required) assert.ok(k in r, `missing ${k}`);
    for (const k of Object.keys(r)) assert.ok(k in schema.properties, `extra ${k}`);
    assert.ok(schema.properties.status.enum.includes(r.status));
  }
});
