import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stage } from '../scripts/stage.mjs';
import { staleFiles } from '../scripts/sync.mjs';

const GOOD = fileURLToPath(new URL('./fixtures/check/good', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/stage.mjs', import.meta.url));
const ST = 'plugins/demo-plugin/status.json';

function copy(t, status) {
  const dir = mkdtempSync(join(tmpdir(), 'stage-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(GOOD, dir, { recursive: true });
  if (status) writeFileSync(join(dir, ST), JSON.stringify(status, null, 2) + '\n');
  return dir;
}
const status = (dir) => JSON.parse(readFileSync(join(dir, ST), 'utf8'));
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('sandbox → incubating: writes stage + since, syncs catalogues, all gates pass', (t) => {
  const dir = copy(t, { stage: 'sandbox', since: '2026-10-01' });
  const r = stage(dir, 'demo-plugin', 'incubating', { today: '2026-11-08', log: () => {} });
  assert.equal(r.ready, true);
  assert.deepEqual(r.items.map((x) => x.gate), ['step', 'evals', 'owner', 'security']);
  assert.deepEqual(status(dir), { stage: 'incubating', since: '2026-11-08' });
  assert.deepEqual(staleFiles(dir), []);
  const latest = JSON.parse(readFileSync(join(dir, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.match(latest.plugins[0].description, /^Incubating: /);
});

test('incubating → published too early prints a FAIL line and exits 1, but still writes', (t) => {
  const dir = copy(t, { stage: 'incubating', since: '2026-11-01' });
  const r = run('demo-plugin', 'published', '--root', dir, '--today', '2026-11-08');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^FAIL soak: incubating for 7 days/m);
  assert.match(r.stdout, /^PASS changelog: /m);
  assert.match(r.stdout, /NOT READY/);
  assert.equal(status(dir).stage, 'published');
});

test('consumers file counts towards the soak gate', (t) => {
  const dir = copy(t, { stage: 'incubating', since: '2026-11-01' });
  const file = join(dir, 'consumers.json');
  writeFileSync(file, JSON.stringify({ rows: ['org/a', 'org/b'].map((consumer) => ({ plugin: 'demo-plugin', consumer, status: 'active' })) }));
  const r = run('demo-plugin', 'published', '--root', dir, '--today', '2026-11-08', '--consumers', file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^PASS soak: .*2 active consumer/m);
  assert.match(r.stdout, /READY/);
});

test('deprecate with --reason records the reason', (t) => {
  const dir = copy(t);
  const r = stage(dir, 'demo-plugin', 'deprecated', { reason: 'superseded by x', today: '2026-11-08', log: () => {} });
  assert.equal(r.ready, true);
  assert.deepEqual(status(dir), { stage: 'deprecated', since: '2026-11-08', reason: 'superseded by x' });
});

test('an illegal move or unknown plugin/stage changes nothing and exits 1', (t) => {
  const dir = copy(t);
  const before = readFileSync(join(dir, ST), 'utf8');
  let r = run('demo-plugin', 'sandbox', '--root', dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /published → sandbox is not allowed/);
  r = run('demo-plugin', 'shipped', '--root', dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown stage "shipped"/);
  r = run('nope', 'deprecated', '--root', dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /plugins\/nope/);
  assert.equal(readFileSync(join(dir, ST), 'utf8'), before);
});
