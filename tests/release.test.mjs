import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRepo } from '../scripts/lib/plugins.mjs';
import { planReleases } from '../scripts/release.mjs';

function fixture(plugins) {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  for (const [dir, { name = dir, version, changelog }] of Object.entries(plugins)) {
    const p = join(root, 'plugins', dir);
    mkdirSync(join(p, '.claude-plugin'), { recursive: true });
    writeFileSync(join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version }));
    if (changelog !== undefined) writeFileSync(join(p, 'CHANGELOG.md'), changelog);
  }
  return loadRepo(root);
}

const CL = `# Changelog

## [1.1.0] - 2026-11-08

### Added
- supersede-adr

## [1.0.0] - 2026-11-07

### Added
- create-adr
`;

test('plans a release for each plugin whose tag is absent, with that version\'s notes', () => {
  const repo = fixture({
    'adr-helper': { version: '1.1.0', changelog: CL },
    'go-helper': { version: '1.0.0', changelog: '# Changelog\n\n## [1.0.0] - 2026-11-08\n\n- first\n' },
  });
  const plan = planReleases(repo, ['adr-helper--v1.0.0']);
  assert.deepEqual(plan, [
    { plugin: 'adr-helper', dir: 'adr-helper', version: '1.1.0', tag: 'adr-helper--v1.1.0', notes: '### Added\n- supersede-adr' },
    { plugin: 'go-helper', dir: 'go-helper', version: '1.0.0', tag: 'go-helper--v1.0.0', notes: '- first' },
  ]);
});

test('a no-bump merge (all tags present) plans nothing — idempotent', () => {
  const repo = fixture({ 'adr-helper': { version: '1.1.0', changelog: CL } });
  assert.deepEqual(planReleases(repo, new Set(['adr-helper--v1.0.0', 'adr-helper--v1.1.0'])), []);
});

test('missing changelog section gets a fallback note; invalid manifests are skipped', () => {
  const repo = fixture({
    'a-plugin': { version: '2.0.0', changelog: CL },
    'b-plugin': { version: 'not-semver' },
  });
  const plan = planReleases(repo, []);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].tag, 'a-plugin--v2.0.0');
  assert.match(plan[0].notes, /No CHANGELOG entry/);
});
