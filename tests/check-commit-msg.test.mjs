import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMessage } from '../scripts/lib/commit-msg.mjs';

test('checkMessage accepts Conventional Commits', () => {
  for (const ok of [
    'feat: add thing',
    'fix(adr-helper): handle empty dir',
    'feat(api)!: drop v1',
    'chore(stable): promote main@abc1234',
    'revert: undo x',
  ]) assert.equal(checkMessage(ok), null, ok);
});

test('checkMessage rejects bad messages', () => {
  for (const bad of ['Add thing', 'feature: x', 'feat:x', 'feat(): x', 'feat(Scope): x', 'feat: ', 'feat: ' + 'x'.repeat(101)]) {
    assert.equal(typeof checkMessage(bad), 'string', bad);
  }
});

const HOOK = fileURLToPath(new URL('../.githooks/commit-msg', import.meta.url));
function runHook(msg) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-'));
  const f = join(dir, 'MSG');
  writeFileSync(f, msg);
  return spawnSync(HOOK, [f], { encoding: 'utf8' });
}

test('commit-msg hook is executable and enforces the rule', () => {
  assert.equal(runHook('feat: ok\n\nbody\n').status, 0);
  assert.equal(runHook('# comment\nfix(x): ok\n').status, 0);
  assert.equal(runHook("Merge branch 'main'\n").status, 0);
  assert.equal(runHook('fixup! feat: ok\n').status, 0);
  const bad = runHook('updated stuff\n');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Conventional Commit/);
});
