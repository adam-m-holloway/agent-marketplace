import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadRepo } from '../scripts/lib/plugins.mjs';
import {
  buildData, consumersByPlugin, readGitData, skillMeta, CONSUMERS_NOTE,
  changelogDate, lastUpdated, scoreFields, readScoreData,
} from '../scripts/build-site.mjs';

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

test('site search: exact name/description matches first, strict fuzzy only as a fallback', () => {
  // Load the browser scripts exactly as the page does: plain scripts on a global object.
  const ctx = vm.createContext({});
  for (const f of ['site/vendor/fuse.min.js', 'site/search-options.js']) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx);
  const { Fuse, searchPlugins } = ctx;
  // The real listed plugins' names and descriptions.
  const cat = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')).plugins;
  const docs = cat.map((p) => ({ name: p.name, description: p.description }));
  const names = (q) => Array.from(searchPlugins(docs, q, Fuse), (r) => docs[r.refIndex].name);
  assert.deepEqual(names('adr'), ['adr-helper'], '"adr" must not match unrelated plugins');
  assert.equal(names('adr helpr')[0], 'adr-helper', 'typos still find the plugin');
  assert.ok(names('conventions').includes('go-conventions') && names('conventions').includes('typescript-conventions'));
  assert.ok(!names('conventions').includes('adr-helper'));
  assert.equal(names('').length, docs.length);
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

// --- scores + last updated --------------------------------------------------------------------
const CHANGELOG = '# Changelog\n\n## [1.1.1] - 2026-11-08\n\n### Fixed\n\n- x\n\n## [1.1.0] - 2026-11-07\n';

test('lastUpdated: tag date wins; falls back to the CHANGELOG date for the current version', () => {
  assert.deepEqual(lastUpdated('1.1.1', '2026-11-09', CHANGELOG), { date: '2026-11-09', version: '1.1.1', source: 'tag' });
  assert.deepEqual(lastUpdated('1.1.0', null, CHANGELOG), { date: '2026-11-07', version: '1.1.0', source: 'changelog' });
  assert.deepEqual(lastUpdated('2.0.0', null, CHANGELOG), { date: null, version: '2.0.0', source: null });
  assert.equal(changelogDate(CHANGELOG, '1.1.1'), '2026-11-08');
  assert.equal(changelogDate(CHANGELOG, '1.1'), null);
  assert.equal(changelogDate('## [1x1x1] - 2026-01-01', '1.1.1'), null, 'dots are literal');
  assert.equal(changelogDate('## [1.0.0+a(b] - 2026-01-02', '1.0.0+a(b'), '2026-01-02', 'regex characters are escaped');
  assert.equal(changelogDate(null, '1.0.0'), null);
});

const H = [
  { plugin: 'adr-helper', version: '1.0.0', recorded_at: '2026-11-08T10:03:03.000Z', security: 60, quality: 85 },
  { plugin: 'adr-helper', version: '1.1.0', recorded_at: '2026-11-08T11:24:34.000Z', security: 100, quality: 100, evals: { pass_rate: 100 } },
  { plugin: 'go-conventions', version: '1.0.0', recorded_at: '2026-11-08T11:13:05.000Z', security: 100, quality: 100 },
];
const CUR = { security: { score: 100 }, quality: { score: 90 }, evals: { pass_rate: 100 } };

test('scoreFields: a patch version compares with the previous tracked (major/minor) record', () => {
  const latestEntry = { version: '1.1.1', recorded_at: '2026-11-08T12:43:26.000Z', tracked: false, reason: 'patch' };
  const f = scoreFields({ name: 'adr-helper', version: '1.1.1', scores: CUR, history: H, latestEntry, builtAt: 'BUILD' });
  assert.deepEqual(f.score_history.map((r) => r.version), ['1.0.0', '1.1.0']);
  assert.deepEqual(f.score_change, { vs_version: '1.1.0', security: 0, security_basis: 'rules + SkillSpector', quality: -10, evals: null });
  assert.deepEqual(f.scored, { at: '2026-11-08T12:43:26.000Z', version: '1.1.1', tracked: false, reason: 'patch', source: 'release' });
});

test('scoreFields: a tracked version compares with the version before it; no data branch → build time', () => {
  const f = scoreFields({ name: 'adr-helper', version: '1.1.0', scores: CUR, history: H, builtAt: 'BUILD' });
  assert.equal(f.score_change.vs_version, '1.0.0');
  assert.equal(f.score_change.security, 40);
  assert.equal(f.scored.tracked, true);
  assert.equal(f.scored.at, '2026-11-08T11:24:34.000Z');
  const none = scoreFields({ name: 'adr-helper', version: '1.1.1', scores: CUR, history: [], builtAt: 'BUILD' });
  assert.deepEqual(none, { score_history: [], score_change: null, scored: { at: 'BUILD', version: '1.1.1', tracked: true, reason: null, source: 'build' } });
  const patch = scoreFields({ name: 'adr-helper', version: '1.1.1', scores: CUR, history: H, builtAt: 'BUILD' });
  assert.deepEqual([patch.scored.tracked, patch.scored.reason, patch.scored.source], [false, 'patch', 'build']);
});

test('readScoreData: reads every scores/**.ndjson and latest/scores.json; missing data branch → empty', () => {
  const files = { 'scores/year=2026/month=11/2026-11-08.ndjson': H.map((r) => JSON.stringify(r)).join('\n') + '\n', 'latest/scores.json': '{"plugins":{}}' };
  const d = readScoreData((ref, p) => files[p] ?? null, () => Object.keys(files));
  assert.equal(d.scoreHistory.length, 3);
  assert.deepEqual(d.scoresLatest, { plugins: {} });
  assert.deepEqual(readScoreData(() => null, () => []), { scoreHistory: [], scoresLatest: null });
});

test('buildData: every plugin carries scores, last_updated and the explained rules', () => {
  const repo = loadRepo(ROOT);
  const d = buildData(repo, { now: NOW, tagDates: { 'adr-helper': '2026-11-08' }, skillspector: { 'adr-helper': 0 } });
  const adr = d.plugins.find((p) => p.name === 'adr-helper');
  assert.equal(adr.scores.security.score, 100);
  assert.equal(adr.scores.security.inputs, '0 HIGH, 0 MEDIUM; SkillSpector risk 0/100');
  assert.equal(adr.scores.evals.measured_version, '1.1.0');
  assert.equal(adr.scores.evals.earlier_version, true);
  assert.deepEqual(adr.last_updated, { date: '2026-11-08', version: adr.versions.latest, source: 'tag' });
  assert.equal(d.skillspector_ran, true);
  assert.deepEqual(d.scores_explained.quality_criteria.map((c) => c.id), ['linters', 'best-practice', 'docs']);
  assert.equal(d.quality_tools_ran, false);
  assert.ok(d.scores_explained.tracking.some((l) => /major and minor/.test(l)));
  const go = d.plugins.find((p) => p.name === 'go-conventions');
  assert.equal(go.scores.security.skillspector_risk, null);
  assert.equal(go.last_updated.source, 'changelog');
});

test('dropSection removes one section (fenced headings ignored) and keeps the rest', async () => {
  const { dropSection } = await import('../scripts/build-site.mjs');
  const md = '# T\n\n## Skills\n\na\n\n## Install\n\n```sh\n# not a heading\n```\n\n### Sub\n\nx\n\n## Changes\n\nb\n';
  const out = dropSection(md, 'Install');
  assert.ok(!out.includes('## Install') && !out.includes('not a heading') && !out.includes('### Sub'), out);
  assert.ok(out.includes('## Skills') && out.includes('## Changes'), out);
});
