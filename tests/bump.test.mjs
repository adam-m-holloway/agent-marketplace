import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../scripts/new-plugin.mjs';
import { bump, insertChangelogStub } from '../scripts/bump.mjs';
import { listVersions, getSection } from '../scripts/lib/changelog.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/bump.mjs', import.meta.url));
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'bump-'));
  scaffold(root, { name: 'demo-x', today: '2026-11-01' });
  return root;
};
const version = (root) => JSON.parse(readFileSync(join(root, 'plugins/demo-x/.claude-plugin/plugin.json'), 'utf8')).version;
const changelog = (root) => readFileSync(join(root, 'plugins/demo-x/CHANGELOG.md'), 'utf8');

test('bump updates plugin.json and inserts a dated stub at the top', () => {
  const root = fixture();
  const r = bump(root, 'demo-x', 'minor', { existingTags: ['demo-x--v1.0.0'], today: '2026-11-08' });
  assert.deepEqual(r, { from: '1.0.0', to: '1.1.0' });
  assert.equal(version(root), '1.1.0');
  const cl = changelog(root);
  assert.deepEqual(listVersions(cl).map((v) => [v.version, v.date]), [['1.1.0', '2026-11-08'], ['1.0.0', '2026-11-01']]);
  assert.equal(getSection(cl, '1.1.0'), '### Changed\n\n- TODO');
  assert.match(cl, /^# Changelog\n/);
});

test('a second unreleased bump is refused (fixture double bump)', () => {
  const root = fixture();
  bump(root, 'demo-x', 'patch', { existingTags: ['demo-x--v1.0.0'], today: '2026-11-08' });
  assert.throws(
    () => bump(root, 'demo-x', 'patch', { existingTags: ['demo-x--v1.0.0'], today: '2026-11-08' }),
    /1\.0\.1 is not released yet.*--force/s,
  );
  assert.equal(version(root), '1.0.1');
  // --force escape hatch
  bump(root, 'demo-x', 'patch', { existingTags: ['demo-x--v1.0.0'], force: true, today: '2026-11-08' });
  assert.equal(version(root), '1.0.2');
});

test('bump rejects unknown plugin and bad level', () => {
  const root = fixture();
  assert.throws(() => bump(root, 'nope', 'patch', { existingTags: [] }), /plugins\/nope/);
  assert.throws(() => bump(root, 'demo-x', 'huge', { existingTags: ['demo-x--v1.0.0'] }), /patch\|minor\|major/);
});

test('insertChangelogStub appends after the title when there are no versions', () => {
  assert.equal(insertChangelogStub('# Changelog\n', '1.0.1', '2026-11-08'),
    '# Changelog\n\n## [1.0.1] - 2026-11-08\n\n### Changed\n\n- TODO\n');
});

test('CLI refuses an unreleased bump with exit 1 (no tags in a non-git dir)', () => {
  const root = fixture();
  const r = spawnSync('node', [SCRIPT, 'demo-x', 'patch', '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not released yet/);
  const f = spawnSync('node', [SCRIPT, 'demo-x', 'patch', '--root', root, '--force'], { encoding: 'utf8' });
  assert.equal(f.status, 0, f.stderr);
  assert.match(f.stdout, /1\.0\.0 -> 1\.0\.1/);
});
