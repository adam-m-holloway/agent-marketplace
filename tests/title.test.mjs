import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const lib = new URL('../scripts/lib/commit-msg.mjs', import.meta.url).pathname;
const script = new URL('../scripts/check-title.mjs', import.meta.url).pathname;
const skip = existsSync(lib) ? false : 'scripts/lib/commit-msg.mjs not present yet';
const run = (title) => spawnSync(process.execPath, [script, title], { encoding: 'utf8' });

test('check-title accepts a Conventional Commits title', { skip }, () => {
  const r = run('feat(adr-helper): add supersede skill');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('check-title rejects a non-conventional title', { skip }, () => {
  const r = run('Update stuff');
  assert.equal(r.status, 1);
});

test('check-title fails with usage when no title is given', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, PR_TITLE: '' } });
  assert.equal(r.status, 2);
});
