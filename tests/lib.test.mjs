import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, compare, bump, isValid } from '../scripts/lib/semver.mjs';
import { getSection, hasEntry, listVersions } from '../scripts/lib/changelog.mjs';

test('semver parses, compares and bumps', () => {
  assert.deepEqual(parse('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.equal(isValid('1.0'), false);
  assert.equal(isValid('01.0.0'), false);
  assert.equal(compare('1.10.0', '1.9.9'), 1);
  assert.equal(compare('1.0.0', '1.0.0'), 0);
  assert.equal(compare('0.9.0', '1.0.0'), -1);
  assert.equal(bump('1.2.3', 'patch'), '1.2.4');
  assert.equal(bump('1.2.3', 'minor'), '1.3.0');
  assert.equal(bump('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bump('1.2.3', 'huge'));
});

const CL = `# Changelog

## [1.1.0] - 2026-11-08

### Added
- supersede-adr

## [1.0.0] - 2026-11-07

### Added
- create-adr
`;

test('changelog extracts a version section', () => {
  assert.deepEqual(listVersions(CL).map((v) => v.version), ['1.1.0', '1.0.0']);
  assert.equal(getSection(CL, '1.1.0'), '### Added\n- supersede-adr');
  assert.equal(getSection(CL, '1.0.0'), '### Added\n- create-adr');
  assert.equal(getSection(CL, '2.0.0'), null);
  assert.equal(hasEntry(CL, '1.0.0'), true);
  assert.equal(hasEntry(CL, '1.2.0'), false);
});
