import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffold, validateName } from '../scripts/new-plugin.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/new-plugin.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'scaffold-'));
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('scaffold demo-x creates every file with sandbox stage and TODO stubs', () => {
  const root = tmp();
  const files = scaffold(root, { name: 'demo-x', today: '2026-11-08' });
  const p = join(root, 'plugins/demo-x');
  for (const f of [
    '.claude-plugin/plugin.json', 'catalogue.json', 'status.json', 'README.md', 'CHANGELOG.md',
    'skills/demo-x/SKILL.md', 'skills/demo-x/evals/evals.json', 'skills/demo-x/evals/trigger-evals.json',
  ]) {
    assert.ok(existsSync(join(p, f)), `missing ${f}`);
    assert.ok(files.includes(`plugins/demo-x/${f}`), `not reported ${f}`);
  }
  const manifest = json(join(p, '.claude-plugin/plugin.json'));
  assert.deepEqual(Object.keys(manifest), ['name', 'version', 'description', 'author', 'keywords', 'license']);
  assert.equal(manifest.name, 'demo-x');
  assert.equal(manifest.version, '1.0.0');
  assert.match(manifest.description, /^TODO/);
  assert.deepEqual(manifest.author, { name: 'Adam Holloway' });
  assert.equal(manifest.license, 'MIT');
  assert.deepEqual(json(join(p, 'catalogue.json')),
    { category: 'engineering-practices', owner: 'Adam Holloway', languages: ['any'] });
  assert.deepEqual(json(join(p, 'status.json')), { stage: 'sandbox', since: '2026-11-08' });
  assert.match(readFileSync(join(p, 'CHANGELOG.md'), 'utf8'), /^## \[1\.0\.0\] - 2026-11-08$/m);

  const md = readFileSync(join(p, 'skills/demo-x/SKILL.md'), 'utf8');
  assert.match(md, /^---\nname: demo-x\ndescription: "?TODO/);
  assert.doesNotMatch(md, /compatibility:/);

  const evals = json(join(p, 'skills/demo-x/evals/evals.json'));
  assert.equal(evals.skill_name, 'demo-x');
  assert.ok(evals.evals.length >= 1);
  assert.match(JSON.stringify(evals), /TODO/);
  const trig = json(join(p, 'skills/demo-x/evals/trigger-evals.json'));
  assert.ok(Array.isArray(trig));
  assert.ok(trig.length < 16, 'stub trigger set must be under the schema minimum');
  assert.ok(trig.every((t) => /TODO/.test(t.query) && typeof t.should_trigger === 'boolean'));
});

test('scaffold honours --skill, --languages and --category', () => {
  const root = tmp();
  scaffold(root, { name: 'go-x', skill: 'go-style', languages: ['go', 'typescript'], category: 'language-conventions', today: '2026-11-08' });
  const p = join(root, 'plugins/go-x');
  assert.deepEqual(json(join(p, 'catalogue.json')).languages, ['go', 'typescript']);
  assert.equal(json(join(p, 'catalogue.json')).category, 'language-conventions');
  const md = readFileSync(join(p, 'skills/go-style/SKILL.md'), 'utf8');
  assert.match(md, /name: go-style/);
  assert.match(md, /compatibility: "?TODO/);
  assert.equal(json(join(p, 'skills/go-style/evals/evals.json')).skill_name, 'go-style');
});

test('name rules: non-kebab, reserved prefix, too long, existing folder', () => {
  const root = tmp();
  mkdirSync(join(root, 'plugins/taken'), { recursive: true });
  assert.match(validateName(root, 'Demo_X'), /kebab-case/);
  assert.match(validateName(root, 'demo--x'), /kebab-case/);
  assert.match(validateName(root, 'claude-tools'), /reserved prefix "claude-"/);
  assert.match(validateName(root, 'anthropic-x'), /reserved prefix/);
  assert.match(validateName(root, 'cc-plugin-x'), /reserved prefix/);
  assert.match(validateName(root, 'a'.repeat(65)), /64/);
  assert.match(validateName(root, 'taken'), /already exists/);
  assert.equal(validateName(root, 'demo-x'), null);
  assert.throws(() => scaffold(root, { name: 'taken' }), /already exists/);
  assert.throws(() => scaffold(root, { name: 'demo-x', skill: 'Bad Skill' }), /kebab-case/);
});

test('CLI exits 1 with a clear message on a bad name and prints next steps on success', () => {
  const root = tmp();
  const bad = spawnSync('node', [SCRIPT, 'claude-x', '--root', root], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /reserved prefix/);
  const ok = spawnSync('node', [SCRIPT, 'demo-x', '--root', root, '--languages', 'go,ts'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Run \/skill-creator/);
  assert.match(ok.stdout, /skills\/demo-x\/evals\/trigger-evals\.json/);
  assert.match(ok.stdout, /npm run check/);
  assert.deepEqual(json(join(root, 'plugins/demo-x/catalogue.json')).languages, ['go', 'ts']);
});

// Fixture repo with three existing plugins (not the real plugins/, which changes independently).
function withPlugins() {
  const root = tmp();
  const mk = (name, description, keywords, category) => {
    mkdirSync(join(root, 'plugins', name, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, 'plugins', name, '.claude-plugin/plugin.json'), JSON.stringify({ name, version: '1.0.0', description, keywords }));
    writeFileSync(join(root, 'plugins', name, 'catalogue.json'), JSON.stringify({ category }));
  };
  mk('adr-helper', 'Write Architecture Decision Records in MADR format', ['adr', 'architecture', 'documentation'], 'documentation');
  mk('go-conventions', 'Go house conventions: wrapped errors, table-driven tests, gofmt', ['go', 'conventions'], 'language-conventions');
  mk('typescript-conventions', 'TypeScript house conventions: strict mode, Vitest tests', ['typescript', 'conventions'], 'language-conventions');
  return root;
}
const ADR_DESC = 'Write architecture decision records (ADRs) in MADR format';

test('--description warns with similar plugins; --yes scaffolds without prompting', () => {
  const root = withPlugins();
  const r = spawnSync('node', [SCRIPT, 'adr-writer', '--root', root, '--description', ADR_DESC, '--yes'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Similar existing plugins/);
  assert.match(r.stdout, /adr-helper \(score 0\.\d+\)/);
  assert.doesNotMatch(r.stdout, /go-conventions/);
  assert.doesNotMatch(r.stdout, /continue anyway/);
  assert.equal(json(join(root, 'plugins/adr-writer/.claude-plugin/plugin.json')).description, ADR_DESC);
});

test('--description without --yes asks "continue anyway? [y/N]" and defaults to No', () => {
  const root = withPlugins();
  const no = spawnSync('node', [SCRIPT, 'adr-writer', '--root', root, '--description', ADR_DESC], { encoding: 'utf8', input: '\n' });
  assert.equal(no.status, 1);
  assert.match(no.stdout, /continue anyway\? \[y\/N\]/);
  assert.match(no.stderr, /aborted/);
  assert.ok(!existsSync(join(root, 'plugins/adr-writer')));
  const eof = spawnSync('node', [SCRIPT, 'adr-writer', '--root', root, '--description', ADR_DESC], { encoding: 'utf8', input: '' });
  assert.equal(eof.status, 1);
  const yes = spawnSync('node', [SCRIPT, 'adr-writer', '--root', root, '--description', ADR_DESC], { encoding: 'utf8', input: 'y\n' });
  assert.equal(yes.status, 0, yes.stderr);
  assert.ok(existsSync(join(root, 'plugins/adr-writer/.claude-plugin/plugin.json')));
});

test('--description with no similar plugins scaffolds without a prompt', () => {
  const root = withPlugins();
  const r = spawnSync('node', [SCRIPT, 'knit-x', '--root', root, '--description', 'Quantum knitting patterns'], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No similar plugins found/);
  assert.doesNotMatch(r.stdout, /continue anyway/);
});

test('similarPlugins (pure) returns top 3 with scores for a description', async () => {
  const { similarPlugins } = await import('../scripts/new-plugin.mjs');
  const root = withPlugins();
  const r = similarPlugins(root, 'adr-writer', ADR_DESC);
  assert.equal(r[0].name, 'adr-helper');
  assert.ok(r.length <= 3);
});
