import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CHANNELS } from '../scripts/lib/plugins.mjs';
import { staleFiles } from '../scripts/sync.mjs';

const SYNC = fileURLToPath(new URL('../scripts/sync.mjs', import.meta.url));
const fixture = (n) => fileURLToPath(new URL(`./fixtures/sync/${n}`, import.meta.url));

function tempCopy(n) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-test-'));
  cpSync(fixture(n), dir, { recursive: true });
  return dir;
}
const run = (...args) => spawnSync(process.execPath, [SYNC, ...args], { encoding: 'utf8' });

test('sync writes both catalogues; running twice is byte-identical', (t) => {
  const dir = tempCopy('good');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r1 = run('--root', dir);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const first = CHANNELS.map((c) => readFileSync(join(dir, c.file), 'utf8'));
  const r2 = run('--root', dir);
  assert.equal(r2.status, 0);
  assert.deepEqual(CHANNELS.map((c) => readFileSync(join(dir, c.file), 'utf8')), first);
  assert.equal(r1.stdout, r2.stdout);
  assert.match(r1.stdout, /sync: 4 listed, 2 excluded/);
  assert.ok(first[0].endsWith('}\n'));
});

test('sync prints every exclusion reason on one line per plugin', () => {
  const r = run('--root', fixture('mutate'), '--check'); // --check: never writes into the fixture
  assert.match(r.stdout, /^excluded many-problems: stage is sandbox \(not listed\); category "gardening" is not in taxonomy; keyword "blockchain" is not in taxonomy tags; keyword "nft" is not in taxonomy tags$/m);
  assert.match(r.stdout, /^excluded a-very-long-plugin-name-that-goes-well-past-the-sixty-four-limitx: name too long \(65 > 64\)$/m);
  assert.match(r.stdout, /^excluded listed-sandbox: stage is sandbox/m);
  assert.equal(r.stdout.match(/^excluded /gm).length, 10);
});

test('--check detects missing and stale catalogues and writes nothing', (t) => {
  const dir = tempCopy('good');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(staleFiles(dir), CHANNELS.map((c) => c.file)); // nothing generated yet
  const missing = run('--root', dir, '--check');
  assert.equal(missing.status, 1);
  assert.deepEqual(staleFiles(dir), CHANNELS.map((c) => c.file)); // --check wrote nothing

  assert.equal(run('--root', dir).status, 0);
  assert.deepEqual(staleFiles(dir), []);
  assert.equal(run('--root', dir, '--check').status, 0);

  // sandbox → incubating changes only latest (stable lists published + deprecated only)
  const st = join(dir, 'plugins/alpha-sandbox/status.json');
  writeFileSync(st, readFileSync(st, 'utf8').replace('sandbox', 'incubating'));
  const stale = run('--root', dir, '--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /^stale \.claude-plugin\/marketplace\.json/m);
  assert.doesNotMatch(stale.stdout, /marketplace-stable/);
  // incubating → published reaches stable too
  writeFileSync(st, readFileSync(st, 'utf8').replace('incubating', 'published'));
  assert.deepEqual(staleFiles(dir), CHANNELS.map((c) => c.file));

  // a hand edit to one generated file is detected for that file only
  assert.equal(run('--root', dir).status, 0);
  const f = join(dir, CHANNELS[1].file);
  writeFileSync(f, readFileSync(f, 'utf8').replace('"plugins"', '"plugins" ').trimEnd());
  assert.deepEqual(staleFiles(dir), [CHANNELS[1].file]);
});
