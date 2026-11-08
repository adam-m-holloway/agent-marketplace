import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadRepo } from '../scripts/lib/plugins.mjs';
import { buildData, consumersByPlugin, readGitData, skillMeta, CONSUMERS_NOTE } from '../scripts/build-site.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(ROOT, 'scripts/build-site.mjs');
const good = loadRepo(fileURLToPath(new URL('./fixtures/sync/good', import.meta.url)));
const NOW = '2026-11-08T12:00:00.000Z';

test('buildData lists listed plugins; missing stable branch and data branch degrade to null/[]', () => {
  const d = buildData(good, { stableVersions: null, consumersDoc: null, now: NOW });
  assert.equal(d.generated_at, NOW);
  assert.equal(d.repo, 'adam-m-holloway/agent-marketplace');
  assert.deepEqual(d.channels.map((c) => [c.id, c.name, c.ref]), [
    ['latest', 'agent-marketplace', 'main'],
    ['stable', 'agent-marketplace-stable', 'stable'],
  ]);
  assert.deepEqual(d.plugins.map((p) => p.name), ['beta-incubating', 'delta-deprecated', 'gamma-deprecated', 'zeta-published']);
  for (const p of d.plugins) {
    assert.equal(p.versions.latest, '1.0.0');
    assert.equal(p.versions.stable, null);
    assert.deepEqual(p.consumers, []);
  }
  const g = d.plugins.find((p) => p.name === 'gamma-deprecated');
  assert.equal(g.stage, 'deprecated');
  assert.equal(g.replaced_by, 'zeta-published');
  assert.equal(g.readme_url, 'https://github.com/adam-m-holloway/agent-marketplace/blob/main/plugins/gamma-deprecated/README.md');
  assert.equal(d.consumers_note, CONSUMERS_NOTE);
});

test('buildData sandbox section: excluded plugins with reasons, retired hidden', () => {
  const d = buildData(good, { now: NOW });
  assert.deepEqual(d.sandbox.map((s) => s.name), ['alpha-sandbox']);
  assert.equal(d.sandbox[0].path, 'plugins/alpha-sandbox');
  assert.match(d.sandbox[0].reasons[0], /stage is sandbox/);
});

test('buildData uses stable versions when given; plugin absent on stable → null', () => {
  const d = buildData(good, { stableVersions: { 'zeta-published': '0.9.0' }, now: NOW });
  assert.equal(d.plugins.find((p) => p.name === 'zeta-published').versions.stable, '0.9.0');
  assert.equal(d.plugins.find((p) => p.name === 'beta-incubating').versions.stable, null);
});

test('consumers are grouped by plugin and sorted by consumer', () => {
  const doc = {
    generated_at: NOW, scan_date: '2026-11-08',
    rows: [
      { consumer: 'org/team-b', team: 'team-b', channel: 'stable', plugin: 'zeta-published', version: '0.9.0', versions_behind: 1, first_seen: '2026-11-08', status: 'behind' },
      { consumer: 'org/team-a', team: 'team-a', channel: 'latest', plugin: 'zeta-published', version: '1.0.0', versions_behind: 0, first_seen: '2026-11-08', status: 'current' },
      { consumer: 'org/team-a', team: 'team-a', channel: 'latest', plugin: 'unknown', version: '1.0.0' },
    ],
  };
  const by = consumersByPlugin(doc);
  assert.deepEqual(by['zeta-published'].map((r) => r.team), ['team-a', 'team-b']);
  const d = buildData(good, { consumersDoc: doc, now: NOW });
  const z = d.plugins.find((p) => p.name === 'zeta-published');
  assert.equal(z.consumers.length, 2);
  assert.equal(z.consumers[1].versions_behind, 1);
  assert.deepEqual(consumersByPlugin(null), {});
  assert.deepEqual(consumersByPlugin({ rows: 'garbage' }), {});
});

test('readGitData: missing branches → null; stable versions read per plugin', () => {
  assert.deepEqual(readGitData(good, () => null), { stableVersions: null, consumersDoc: null });
  const files = {
    'origin/stable:': 'tree',
    'origin/stable:plugins/zeta-published/.claude-plugin/plugin.json': '{"version":"0.9.0"}',
    'origin/stable:plugins/beta-incubating/.claude-plugin/plugin.json': 'not json',
    'origin/data:latest/consumers.json': '{"rows":[]}',
  };
  const r = readGitData(good, (ref, path) => files[`${ref}:${path}`] ?? null);
  assert.deepEqual(r.stableVersions, { 'zeta-published': '0.9.0' });
  assert.deepEqual(r.consumersDoc, { rows: [] });
});

test('skillMeta reads name, description and folded compatibility from SKILL.md', () => {
  const md = '---\nname: s\ndescription: "Does a thing"\ncompatibility: >\n  Needs git\n  and node\n---\nbody';
  assert.deepEqual(skillMeta(md, 'fallback'), { name: 's', description: 'Does a thing', compatibility: 'Needs git and node' });
  assert.deepEqual(skillMeta(null, 'x'), { name: 'x', description: '', compatibility: null });
});

test('build-site CLI writes data.json with the adr-helper entry and copies the site', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'site-test-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [BUILD, '--root', ROOT, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ['index.html', 'app.js', 'style.css', 'vendor/fuse.min.js']) assert.ok(existsSync(join(out, f)), f);
  const data = JSON.parse(readFileSync(join(out, 'data.json'), 'utf8'));
  const adr = data.plugins.find((p) => p.name === 'adr-helper');
  assert.ok(adr, 'adr-helper listed');
  assert.equal(adr.category, 'documentation');
  assert.equal(adr.stage, 'published');
  assert.match(adr.versions.latest, /^\d+\.\d+\.\d+$/);
  assert.ok(adr.skills.some((s) => s.name === 'create-adr' && s.description.length > 20));
  assert.ok(Array.isArray(adr.related) && Array.isArray(adr.consumers));
  assert.deepEqual(adr.languages, ['any']);
});

test('vendored Fuse (UMD) finds adr-helper for "adr helpr" with the site options', () => {
  // Load the browser scripts exactly as the page does: plain scripts on a global object.
  const ctx = vm.createContext({});
  for (const f of ['site/vendor/fuse.min.js', 'site/search-options.js']) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx);
  const { Fuse, FUSE_OPTIONS } = ctx;
  const docs = [
    { name: 'adr-helper', description: 'Write Architecture Decision Records', tags: ['adr'], skills: ['create-adr'] },
    { name: 'go-conventions', description: 'Go code style', tags: ['go'], skills: [] },
    { name: 'typescript-conventions', description: 'TypeScript strict mode', tags: ['typescript'], skills: [] },
  ];
  const res = new Fuse(docs, FUSE_OPTIONS).search('adr helpr');
  assert.equal(res[0]?.item.name, 'adr-helper');
});

test('buildData carries consumers_generated_at from latest/consumers.json (null without data)', () => {
  assert.equal(buildData(good, { now: NOW }).consumers_generated_at, null);
  const doc = { generated_at: '2026-11-07T03:17:00.000Z', scan_date: '2026-11-07', rows: [] };
  assert.equal(buildData(good, { consumersDoc: doc, now: NOW }).consumers_generated_at, '2026-11-07T03:17:00.000Z');
  assert.equal(buildData(good, { consumersDoc: { rows: [] }, now: NOW }).consumers_generated_at, null);
});

test('site staleMessage: banner only when usage data is older than 36 hours', () => {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(ROOT, 'site/stale.js'), 'utf8'), ctx);
  const { staleMessage, STALE_HOURS } = ctx;
  assert.equal(STALE_HOURS, 36);
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(staleMessage(null, now), null);
  assert.equal(staleMessage('not a date', now), null);
  assert.equal(staleMessage('2026-11-08T03:17:00Z', now), null); // 9 h
  assert.equal(staleMessage('2026-11-07T00:00:01Z', now), null); // just under 36 h
  assert.equal(staleMessage('2026-11-06T12:00:00Z', now),
    'Usage data is 48 hours old — the nightly insights run may have stopped.');
});
