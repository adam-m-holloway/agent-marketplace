import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));
const GOOD = fileURLToPath(new URL('./fixtures/check/good', import.meta.url));
const MAL = fileURLToPath(new URL('./fixtures/malicious', import.meta.url));
const check = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });

test('check passes on the clean fixture', () => {
  const r = check('--root', GOOD);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /check passed: 0 error, 0 high/);
  assert.match(r.stderr, /notice: version-bump skipped/);
});

test('check reports every failure with severity, rule, file:line and exits 1', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'cli-')), 'repo');
  cpSync(GOOD, root, { recursive: true });
  const S = 'plugins/demo-plugin/skills/demo-skill';
  cpSync(join(MAL, 'pipe-to-shell.md'), join(root, S, 'setup.md'));
  writeFileSync(join(root, 'plugins/demo-plugin/README.md'), '# demo\n<!-- hidden -->\n');
  const r = check('--root', root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, new RegExp(`^HIGH patterns ${S}/setup\\.md:5 pipe-to-shell:`, 'm'));
  assert.match(r.stdout, /^HIGH hidden-content plugins\/demo-plugin\/README\.md:2 html-comment:/m);
  assert.match(r.stdout, /check FAILED: 0 error, 2 high/);

  const sec = check('--root', root, '--only', 'plugins');
  assert.equal(sec.status, 0, sec.stdout);

  const j = check('--root', root, '--json');
  const findings = JSON.parse(j.stdout);
  assert.ok(findings.some((x) => x.rule === 'patterns' && x.line === 5));
});

test('--pr enables CI-only rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-'));
  const pr = join(dir, 'pr.json');
  writeFileSync(pr, JSON.stringify({ title: 'bad title', labels: [], baseRef: 'main', headRef: 'x' }));
  const r = check('--root', GOOD, '--base', GOOD, '--pr', pr);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR pr-title pr title:/m);
});

test('bad arguments exit 2', () => {
  assert.equal(check('--only', 'nope').status, 2);
  assert.equal(check('--bogus').status, 2);
});
