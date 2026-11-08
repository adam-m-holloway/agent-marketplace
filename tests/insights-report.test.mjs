import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { scan } from '../scripts/insights/scan.mjs';
import { HONESTY, consumersByPlugin, renderCatalogueMd, renderSummary } from '../scripts/insights/report.mjs';
import { run } from '../scripts/insights/run.mjs';
import { CHANNELS, REPO } from '../scripts/lib/plugins.mjs';
import { CONSUMERS, loadFixtures, fixtureFetch } from './fixtures/insights/fixture-fetch.mjs';

const fixtures = (...n) => fixtureFetch(loadFixtures('marketplace', ...n));
const scanWith = (...n) => scan({ consumers: CONSUMERS, marketplaceRepo: REPO, channels: CHANNELS, fetch: fixtures(...n), token: 't', today: '2026-11-09', previous: [] });

test('consumersByPlugin groups both consumers under adr-helper', async () => {
  const { rows } = await scanWith('team-a', 'team-b');
  const g = consumersByPlugin(rows);
  assert.deepEqual(Object.keys(g), ['adr-helper', 'go-conventions', 'typescript-conventions']);
  assert.deepEqual(g['adr-helper'], [
    { consumer: 'adam-m-holloway/team-a', team: 'team-a', channel: 'latest', version: '1.1.0', versions_behind: 0, since: '2026-11-08', status: 'active' },
    { consumer: 'adam-m-holloway/team-b', team: 'team-b', channel: 'stable', version: '1.0.0', versions_behind: 1, since: '2026-11-08', status: 'active' },
  ]);
});

test('CATALOGUE.md and summary state committed intent; summary shows channels, behind, health', async () => {
  const { rows, health } = await scanWith('team-a', 'team-b');
  const md = renderCatalogueMd(rows, { generatedAt: '2026-11-09' });
  assert.ok(md.includes(HONESTY));
  assert.match(md, /## adr-helper[\s\S]*team-b \| stable \| 1\.0\.0 \| 1 version behind/);
  const s = renderSummary(rows, health);
  assert.ok(s.includes(HONESTY));
  assert.match(s, /\*\*latest\*\*[\s\S]*\*\*stable\*\*/);
  assert.match(s, /team-b \(adam-m-holloway\/team-b\): adr-helper 1\.0\.0 on stable is 1 version behind/);
  assert.match(s, /All 2 consumer scans succeeded/);
});

test('summary says "token invalid or expired" on 401', async () => {
  const { rows, health } = await scanWith('team-a', 'team-b-401');
  const s = renderSummary(rows, health);
  assert.match(s, /Token invalid or expired/);
  assert.match(s, /1 of 2 consumer scans failed/);
});

function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p);
    }
  };
  walk(dir);
  return out;
}

test('run: writes the data branch layout; a same-day re-run produces identical files', async () => {
  const data = mkdtempSync(join(tmpdir(), 'insights-'));
  const summary = join(data, '..', `summary-${Date.now()}.md`);
  // Yesterday's snapshot: team-b also had a plugin it has since dropped.
  mkdirSync(join(data, 'consumers/year=2026/month=11'), { recursive: true });
  const yesterday = (await scan({ consumers: CONSUMERS, marketplaceRepo: REPO, channels: CHANNELS, fetch: fixtures('team-a', 'team-b'), token: 't', today: '2026-11-08' })).rows;
  writeFileSync(join(data, 'consumers/year=2026/month=11/2026-11-08.ndjson'), yesterday.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const opts = { dataDir: data, today: '2026-11-09', fetch: fixtures('team-a', 'team-b-without-ts'), token: 't', consumers: CONSUMERS, summaryFile: summary };
  await run({ ...opts, now: '2026-11-09T03:17:00.000Z' });
  const first = snapshotTree(data);
  await run({ ...opts, now: '2026-11-09T09:00:00.000Z' });
  const second = snapshotTree(data);

  assert.deepEqual(Object.keys(second).sort(), [
    'CATALOGUE.md',
    'consumers/year=2026/month=11/2026-11-08.ndjson',
    'consumers/year=2026/month=11/2026-11-09.ndjson',
    'events/year=2026/month=11/2026-11-09.ndjson',
    'latest/consumers.json',
    'schema/consumers.schema.json',
    'schema/events.schema.json',
  ]);
  for (const k of Object.keys(first)) assert.ok(first[k].equals(second[k]), `${k} changed on re-run`);

  const events = second['events/year=2026/month=11/2026-11-09.ndjson'].toString().trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => [e.type, e.plugin]), [['removed', 'typescript-conventions']]);
  const latest = JSON.parse(second['latest/consumers.json']);
  assert.deepEqual(Object.keys(latest), ['generated_at', 'scan_date', 'rows']);
  assert.equal(latest.scan_date, '2026-11-09');
  assert.equal(latest.generated_at, '2026-11-09T03:17:00.000Z');
  assert.match(readFileSync(summary, 'utf8'), /## Insights scan 2026-11-09/);
});
