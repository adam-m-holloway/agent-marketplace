import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionChanges, promotionTitle, promotionBody, branchName } from '../scripts/promote.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/promote.mjs', import.meta.url));

test('versionChanges classifies added, removed, up, down and unchanged plugins', () => {
  const changes = versionChanges(
    { a: '1.0.0', b: '1.1.0', c: '2.0.0', d: '1.0.0' },
    { a: '1.1.0', b: '1.0.1', c: '2.0.0', e: '1.0.0' },
  );
  assert.deepEqual(changes, [
    { name: 'a', from: '1.0.0', to: '1.1.0', change: 'up' },
    { name: 'b', from: '1.1.0', to: '1.0.1', change: 'down' },
    { name: 'c', from: '2.0.0', to: '2.0.0', change: 'same' },
    { name: 'd', from: '1.0.0', to: null, change: 'removed' },
    { name: 'e', from: null, to: '1.0.0', change: 'added' },
  ]);
});

test('promotionTitle uses the 7-char short sha; branchName is promote/<date>-<short>', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(promotionTitle(sha), 'chore(stable): promote main@0123456');
  assert.equal(branchName(sha, '2026-11-08'), 'promote/2026-11-08-0123456');
});

test('promotionBody lists each change and flags rollbacks', () => {
  const body = promotionBody(versionChanges({ a: '1.0.0', b: '1.1.0' }, { a: '1.1.0', b: '1.0.1' }));
  assert.match(body, /- a: 1\.0\.0 → 1\.1\.0/);
  assert.match(body, /- b: 1\.1\.0 → 1\.0\.1 \(rollback\)/);
  assert.match(body, /rollback: add the rollback label/);
  assert.doesNotMatch(promotionBody(versionChanges({ a: '1.0.0' }, { a: '1.1.0' })), /rollback/);
});

// --- git flow in a throwaway repo -------------------------------------------------------------
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
const put = (cwd, rel, content) => {
  mkdirSync(dirname(join(cwd, rel)), { recursive: true });
  writeFileSync(join(cwd, rel), content);
};
const plugin = (cwd, name, version) =>
  put(cwd, `plugins/${name}/.claude-plugin/plugin.json`, JSON.stringify({ name, version }) + '\n');

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'promote-'));
  git(cwd, 'init', '-q', '-b', 'main');
  plugin(cwd, 'adr-helper', '1.0.0');
  plugin(cwd, 'old-thing', '1.0.0');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'init');
  git(cwd, 'branch', 'stable');
  plugin(cwd, 'adr-helper', '1.1.0');
  plugin(cwd, 'go-conventions', '1.0.0');
  git(cwd, 'rm', '-q', '-r', 'plugins/old-thing');
  put(cwd, 'README.md', 'main only\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'main work');
  // stand-ins for the fetched remote-tracking refs
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'main');
  git(cwd, 'update-ref', 'refs/remotes/origin/stable', 'stable');
  return cwd;
}

test('promote --dry-run --no-fetch cuts promote/* from stable with exactly main@sha tree', () => {
  const cwd = repo();
  const sha = git(cwd, 'rev-parse', 'main');
  const short = sha.slice(0, 7);
  const r = spawnSync('node', [SCRIPT, '--dry-run', '--no-fetch', '--date', '2026-11-08'], { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const branch = `promote/2026-11-08-${short}`;
  assert.equal(git(cwd, 'rev-parse', `${branch}^{tree}`), git(cwd, 'rev-parse', `${sha}^{tree}`));
  assert.equal(git(cwd, 'rev-parse', `${branch}^`), git(cwd, 'rev-parse', 'stable'), 'parent is stable');
  const msg = git(cwd, 'log', '-1', '--format=%B', branch);
  assert.match(msg, new RegExp(`^chore\\(stable\\): promote main@${short}\\n`));
  assert.match(msg, /- adr-helper: 1\.0\.0 → 1\.1\.0/);
  assert.match(msg, /- go-conventions: new → 1\.0\.0/);
  assert.match(msg, /- old-thing: 1\.0\.0 → removed/);
  assert.match(r.stdout, /dry run: not pushing/);
  assert.equal(git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'returns to the original branch');
});

test('promote of an older main commit prints the rollback hint', () => {
  const cwd = repo();
  // stable already has main's newer state; promote the older commit (main^) back
  git(cwd, 'update-ref', 'refs/remotes/origin/stable', 'main');
  const old = git(cwd, 'rev-parse', 'main^');
  const r = spawnSync('node', [SCRIPT, old, '--dry-run', '--no-fetch'], { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rollback: add the rollback label/);
});

test('promote refuses a dirty working tree and a no-op promotion', () => {
  const cwd = repo();
  put(cwd, 'dirty.txt', 'x');
  const dirty = spawnSync('node', [SCRIPT, '--dry-run', '--no-fetch'], { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /working tree is not clean/);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'dirty');
  git(cwd, 'update-ref', 'refs/remotes/origin/stable', 'main');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'main');
  const noop = spawnSync('node', [SCRIPT, '--dry-run', '--no-fetch'], { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(noop.status, 1);
  assert.match(noop.stderr, /already matches/);
});
