import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffFiles } from '../scripts/lib/rules/_util.mjs';

test('diffFiles ignores a .git FILE (git worktrees) as well as a .git directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'diff-base-'));
  const pr = mkdtempSync(join(tmpdir(), 'diff-pr-'));
  for (const d of [base, pr]) { mkdirSync(join(d, 'plugins/p'), { recursive: true }); writeFileSync(join(d, 'plugins/p/a.txt'), 'same'); }
  mkdirSync(join(base, '.git'));                                   // normal checkout
  writeFileSync(join(pr, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n'); // worktree
  assert.deepEqual(diffFiles(base, pr), []);
});
