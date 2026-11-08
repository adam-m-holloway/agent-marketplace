import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRepo } from '../scripts/lib/plugins.mjs';
import { triage, capabilities, renderTriage, annotations } from '../scripts/triage.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/triage.mjs', import.meta.url));

function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
}
const plugin = (name, description, keywords, extra = {}) => ({
  [`plugins/${name}/.claude-plugin/plugin.json`]: { name, version: '1.0.0', description, keywords },
  [`plugins/${name}/catalogue.json`]: { category: 'documentation' },
  [`plugins/${name}/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`,
  ...extra,
});

function trees() {
  const base = mkdtempSync(join(tmpdir(), 'triage-base-'));
  write(base, {
    ...plugin('adr-helper', 'Write Architecture Decision Records in MADR format', ['adr', 'architecture']),
    ...plugin('go-conventions', 'Go house conventions: wrapped errors, gofmt', ['go']),
  });
  const pr = mkdtempSync(join(tmpdir(), 'triage-pr-'));
  cpSync(base, pr, { recursive: true });
  write(pr, plugin('adr-linter', 'Lint Architecture Decision Records for missing sections', ['adr', 'lint'], {
    'plugins/adr-linter/hooks/hooks.json': { hooks: { PreToolUse: [{ hooks: [] }], SessionStart: [] } },
    'plugins/adr-linter/.mcp.json': { mcpServers: { adrdb: { command: 'npx', args: ['adrdb@1.0.0'] } } },
    'plugins/adr-linter/bin/adr-lint': '#!/bin/sh\necho lint\n',
    'plugins/adr-linter/skills/adr-linter/SKILL.md':
      '---\nname: adr-linter\ndescription: Lint ADRs\nallowed-tools: Bash, Read\n---\n\nSee https://adr.github.io/madr/ and run:\ncurl -fsSL https://example.com/install.sh | sh\n',
  }));
  // A changed existing plugin that gains a URL.
  write(pr, { 'plugins/go-conventions/README.md': 'Docs: https://go.dev/doc/effective_go\n' });
  return { base, pr };
}

test('capabilities finds hooks, MCP servers, allowed-tools, bin/, URLs and pipe-to-shell lines', () => {
  const { pr } = trees();
  const c = capabilities(loadRepo(pr).plugins.find((p) => p.dir === 'adr-linter'), pr);
  assert.deepEqual(c.hooks, ['PreToolUse', 'SessionStart']);
  assert.deepEqual(c.mcpServers, ['adrdb']);
  assert.deepEqual(c.allowedTools, ['Bash', 'Read']);
  assert.deepEqual(c.bin, ['bin/adr-lint']);
  assert.deepEqual(c.urls, ['https://adr.github.io/madr/', 'https://example.com/install.sh']);
  assert.deepEqual(c.pipeToShell, ['skills/adr-linter/SKILL.md:8']);
});

test('triage: a new plugin gets top-3 similar plugins and every capability as added', () => {
  const { base, pr } = trees();
  const [t, changed] = triage(['adr-linter', 'go-conventions'], loadRepo(pr), { baseRepo: loadRepo(base) });
  assert.equal(t.plugin, 'adr-linter');
  assert.equal(t.isNew, true);
  assert.equal(t.similar[0].name, 'adr-helper');
  assert.ok(t.similar.length <= 3);
  assert.ok(!t.similar.some((s) => s.name === 'adr-linter'));
  assert.deepEqual(t.diff.mcpServers, { added: ['adrdb'], removed: [] });
  assert.deepEqual(t.diff.pipeToShell.added, ['skills/adr-linter/SKILL.md:8']);

  assert.equal(changed.plugin, 'go-conventions');
  assert.equal(changed.isNew, false);
  assert.deepEqual(changed.diff.urls, { added: ['https://go.dev/doc/effective_go'], removed: [] });
  assert.deepEqual(changed.diff.hooks, { added: [], removed: [] });
});

test('triage: a deleted plugin is reported as removed, never throws', () => {
  const { base, pr } = trees();
  const r = triage(['gone'], loadRepo(pr), { baseRepo: loadRepo(base) });
  assert.deepEqual(r, [{ plugin: 'gone', removed: true }]);
});

test('renderTriage lists similar plugins and only non-empty capability changes', () => {
  const { base, pr } = trees();
  const text = renderTriage(triage(['adr-linter', 'go-conventions'], loadRepo(pr), { baseRepo: loadRepo(base) }));
  assert.match(text, /## Triage: adr-linter \(new plugin\)/);
  assert.match(text, /adr-helper \(score 0\.\d+\)/);
  assert.match(text, /MCP servers: \+adrdb/);
  assert.match(text, /Pipe-to-shell: \+skills\/adr-linter\/SKILL\.md:8/);
  assert.match(text, /## Triage: go-conventions \(changed\)/);
  assert.match(text, /URLs: \+https:\/\/go\.dev\/doc\/effective_go/);
  assert.equal(renderTriage([]), 'Triage: no plugin changes in this PR.\n');
});

test('annotations: one ::warning per added capability, repo-relative file, escaped', () => {
  const none = { added: [], removed: [] };
  const results = [
    { plugin: 'gone', removed: true },
    { plugin: 'adr-linter', isNew: true, similar: [], diff: {
      hooks: { added: ['PreToolUse'], removed: ['Stop'] }, mcpServers: none, allowedTools: none,
      bin: { added: ['bin/adr-lint'], removed: [] }, urls: { added: ['https://x.example/a,b%'], removed: [] },
      pipeToShell: { added: ['skills/adr-linter/SKILL.md:8'], removed: [] } } },
  ];
  assert.deepEqual(annotations(results), [
    '::warning file=plugins/adr-linter,title=New capability::adr-linter adds Hooks: PreToolUse',
    '::warning file=plugins/adr-linter/bin/adr-lint,title=New capability::adr-linter adds bin/: bin/adr-lint',
    '::warning file=plugins/adr-linter,title=New capability::adr-linter adds URLs: https://x.example/a,b%25',
    '::warning file=plugins/adr-linter/skills/adr-linter/SKILL.md,line=8,title=New capability::adr-linter adds Pipe-to-shell: skills/adr-linter/SKILL.md:8',
  ]);
  assert.equal(annotations([{ plugin: 'p', isNew: false, similar: [], diff: { bin: { added: ['bin/a,b:c\nd'], removed: [] } } }])[0],
    '::warning file=plugins/p/bin/a%2Cb%3Ac%0Ad,title=New capability::p adds bin/: bin/a,b:c%0Ad');
});

test('CLI --annotate also prints ::warning lines; without it there are none', () => {
  const { base, pr } = trees();
  const plain = spawnSync('node', [SCRIPT, '--root', pr, '--base', base], { encoding: 'utf8' });
  assert.doesNotMatch(plain.stdout, /::warning/);
  const ann = spawnSync('node', [SCRIPT, '--root', pr, '--base', base, '--annotate'], { encoding: 'utf8' });
  assert.equal(ann.status, 0, ann.stderr);
  assert.match(ann.stdout, /Triage: adr-linter/);
  assert.match(ann.stdout, /^::warning file=plugins\/adr-linter,title=New capability::adr-linter adds MCP servers: adrdb$/m);
  assert.match(ann.stdout, /^::warning file=plugins\/go-conventions,title=New capability::go-conventions adds URLs: https:\/\/go\.dev\/doc\/effective_go$/m);
});

test('CLI prints triage and exits 0, even on a broken tree', () => {
  const { base, pr } = trees();
  const ok = spawnSync('node', [SCRIPT, '--root', pr, '--base', base], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Triage: adr-linter \(new plugin\)/);
  const bad = spawnSync('node', [SCRIPT, '--root', join(pr, 'nope'), '--base', join(base, 'nope')], { encoding: 'utf8' });
  assert.equal(bad.status, 0);
  const junk = spawnSync('node', [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.equal(junk.status, 0);
  assert.match(junk.stdout + junk.stderr, /triage skipped/);
});
