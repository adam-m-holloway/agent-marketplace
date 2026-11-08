import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkWorkflowText } from '../scripts/check-actions-pinned.mjs';

const SHA = 'a'.repeat(40);

test('SHA-pinned and local uses pass', () => {
  const text = `jobs:
  a:
    steps:
      - uses: actions/checkout@${SHA} # v4.2.2
      - uses: ./.github/actions/local
      - name: x
        uses: "actions/setup-node@${SHA}"
  b:
    uses: org/repo/.github/workflows/w.yml@${SHA}
`;
  assert.deepEqual(checkWorkflowText(text, 'w.yml'), []);
});

test('tags, branches, short SHAs and unpinned docker fail with line numbers', () => {
  const text = `steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@main
  - uses: 'foo/bar@abc1234'
  - uses: docker://alpine:3
  - uses: foo/bar
`;
  const f = checkWorkflowText(text, 'w.yml');
  assert.deepEqual(f.map((x) => x.line), [2, 3, 4, 5, 6]);
  assert.ok(f.every((x) => x.rule === 'actions-pinned' && x.severity === 'ERROR' && x.file === 'w.yml'));
});

test('docker digest pins pass; comments are ignored', () => {
  const text = `steps:
  # - uses: actions/checkout@v4
  - uses: docker://alpine@sha256:${'b'.repeat(64)}
`;
  assert.deepEqual(checkWorkflowText(text, 'w.yml'), []);
});

test('CLI exits 1 on an unpinned action and 0 on a clean dir', () => {
  const script = new URL('../scripts/check-actions-pinned.mjs', import.meta.url).pathname;
  const bad = mkdtempSync(join(tmpdir(), 'pin-bad-'));
  writeFileSync(join(bad, 'a.yml'), 'steps:\n  - uses: actions/checkout@v4\n');
  const r1 = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
  assert.equal(r1.status, 1);
  assert.match(r1.stdout + r1.stderr, /actions\/checkout@v4/);
  const good = mkdtempSync(join(tmpdir(), 'pin-good-'));
  writeFileSync(join(good, 'a.yaml'), `steps:\n  - uses: actions/checkout@${SHA}\n`);
  const r2 = spawnSync(process.execPath, [script, good], { encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
});
