// MUTATE: each rule gets a seeded defect (a copy of tests/fixtures/check/good with one thing broken)
// that must fail. The last test asserts every rule module is covered, so deleting a rule fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, buildContext, runChecks, failing } from '../scripts/check.mjs';

const GOOD = fileURLToPath(new URL('./fixtures/check/good', import.meta.url));
const MAL = fileURLToPath(new URL('./fixtures/malicious', import.meta.url));
const LIB = (n) => existsSync(fileURLToPath(new URL(`../scripts/lib/${n}`, import.meta.url)));
const HAS_SCHEMA = LIB('schema.mjs');
const HAS_CATALOGUE = LIB('catalogue.mjs') || existsSync(fileURLToPath(new URL('../scripts/sync.mjs', import.meta.url)));

const P = 'plugins/demo-plugin';
const S = `${P}/skills/demo-skill`;
const rules = await loadRules();
const byId = Object.fromEntries(rules.map((r) => [r.id, r]));

function tree(mutate = () => {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'check-')), 'repo');
  cpSync(GOOD, dir, { recursive: true });
  mutate(dir);
  return dir;
}
const editJson = (dir, rel, fn) => {
  const p = join(dir, rel);
  const v = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify(fn(v) ?? v, null, 2) + '\n');
};
const edit = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

async function run(id, root, { base = null, pr = null } = {}) {
  const r = byId[id];
  assert.ok(r, `rule ${id} exists`);
  return (await r.run(buildContext({ root, base, pr }))).filter((x) => x.rule === id);
}
const errors = (fs) => fs.filter((x) => x.severity !== 'MEDIUM');

const covered = new Set();
/** Register a seeded-defect test for a rule. */
function defect(id, name, fn, opts = {}) {
  covered.add(id);
  test(`${id}: ${name}`, opts, fn);
}

test('the clean fixture passes every rule (including CI-only ones)', async () => {
  const pr = { title: 'feat(demo-plugin): add demo-skill', labels: [], baseRef: 'main', headRef: 'feat/x' };
  const { findings } = await runChecks({ root: GOOD, base: GOOD, pr });
  assert.deepEqual(failing(findings), []);
  if (HAS_SCHEMA && HAS_CATALOGUE) assert.deepEqual(findings, []);
});

defect('structure', 'missing README fails', async () => {
  const fs = await run('structure', tree((d) => rmSync(join(d, P, 'README.md'))));
  assert.match(fs[0].file, /README\.md$/);
});

defect('stale-catalogues', 'hand-edited catalogue fails', async (t) => {
  if (!HAS_CATALOGUE) return t.skip('scripts/lib/catalogue.mjs not available yet');
  assert.deepEqual(errors(await run('stale-catalogues', GOOD)), []);
  const fs = await run('stale-catalogues', tree((d) => editJson(d, '.claude-plugin/marketplace.json', (v) => { v.plugins[0].description = 'tampered'; })));
  assert.equal(errors(fs).length, 1);
});

test('stale-catalogues: missing generator is a single MEDIUM skip', async (t) => {
  if (HAS_CATALOGUE) return t.skip('generator present');
  const fs = await run('stale-catalogues', GOOD);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, 'MEDIUM');
  assert.match(fs[0].message, /rule skipped/);
});

defect('version-bump', 'changed files without a version increase fail', async () => {
  const head = tree((d) => edit(d, `${S}/SKILL.md`, (s) => s + '\n3. Commit it.\n'));
  const fs = await run('version-bump', head, { base: GOOD });
  assert.equal(fs.length, 1);
  assert.match(fs[0].message, /not greater than base 1\.0\.0/);
  // bumped → ok; promotion → exempt; unchanged → ok
  editJson(head, `${P}/.claude-plugin/plugin.json`, (v) => { v.version = '1.0.1'; });
  assert.deepEqual(await run('version-bump', head, { base: GOOD }), []);
  assert.deepEqual(await run('version-bump', GOOD, { base: GOOD }), []);
  editJson(head, `${P}/.claude-plugin/plugin.json`, (v) => { v.version = '1.0.0'; });
  assert.deepEqual(await run('version-bump', head, { base: GOOD, pr: { title: 't', labels: [], baseRef: 'stable', headRef: 'promote/2026-11-08' } }), []);
});

test('version-bump: a new plugin must start at >= 1.0.0', async () => {
  const base = tree((d) => rmSync(join(d, P), { recursive: true }));
  assert.deepEqual(await run('version-bump', GOOD, { base }), []);
  const head = tree((d) => editJson(d, `${P}/.claude-plugin/plugin.json`, (v) => { v.version = '0.9.0'; }));
  assert.match((await run('version-bump', head, { base }))[0].message, />= 1\.0\.0/);
});

test('version-bump is skipped with a notice when there is no base', async () => {
  const { notices, ran } = await runChecks({ root: GOOD });
  assert.ok(!ran.includes('version-bump'));
  assert.ok(notices.some((n) => /version-bump skipped/.test(n)));
});

defect('changelog-entry', 'version without a CHANGELOG section fails', async () => {
  const fs = await run('changelog-entry', tree((d) => editJson(d, `${P}/.claude-plugin/plugin.json`, (v) => { v.version = '1.1.0'; })));
  assert.match(fs[0].message, /\[1\.1\.0\]/);
});

defect('name-consistency', 'folder/manifest mismatch, reserved prefix and skill_name mismatch fail', async () => {
  let fs = await run('name-consistency', tree((d) => editJson(d, `${P}/.claude-plugin/plugin.json`, (v) => { v.name = 'other-plugin'; })));
  assert.ok(fs.some((x) => /must equal folder/.test(x.message)));
  fs = await run('name-consistency', tree((d) => {
    renameSync(join(d, P), join(d, 'plugins/claude-demo'));
    editJson(d, 'plugins/claude-demo/.claude-plugin/plugin.json', (v) => { v.name = 'claude-demo'; });
  }));
  assert.ok(fs.some((x) => /reserved prefix "claude-"/.test(x.message)));
  fs = await run('name-consistency', tree((d) => editJson(d, `${S}/evals/evals.json`, (v) => { v.skill_name = 'wrong'; })));
  assert.ok(fs.some((x) => /skill_name "wrong"/.test(x.message)));
});

defect('skill-frontmatter', 'missing description fails', async () => {
  const fs = await run('skill-frontmatter', tree((d) => edit(d, `${S}/SKILL.md`, (s) => s.replace(/^description:.*\n/m, ''))));
  assert.equal(fs.length, 1);
  assert.match(fs[0].message, /description is required/);
  assert.equal(fs[0].line, 1);
});

defect('evals', 'too few cases, placeholders, missing files, duplicate ids fail', async () => {
  const fs = await run('evals', tree((d) => editJson(d, `${S}/evals/evals.json`, (v) => {
    v.evals[0].expected_output = 'TODO';
    v.evals[1].files = ['evals/files/nope.md'];
    v.evals[2].id = 1;
    v.evals.push({ id: 4, prompt: 'p', expected_output: 'o', expectations: [] });
  })));
  const msgs = errors(fs).map((x) => x.message).join('\n');
  assert.match(msgs, /placeholder "TODO"/);
  assert.match(msgs, /does not exist/);
  assert.match(msgs, /duplicate id/);
  assert.match(msgs, /at least one expectation/);
  const few = await run('evals', tree((d) => editJson(d, `${S}/evals/evals.json`, (v) => { v.evals.length = 2; })));
  assert.ok(few.some((x) => /2 eval cases \(min 3\)/.test(x.message)));
});

test('evals: trigger-evals need 8 true + 8 false and no duplicates', async () => {
  const fs = await run('evals', tree((d) => editJson(d, `${S}/evals/trigger-evals.json`, (v) => {
    v[0].should_trigger = false;
    v[1].query = v[2].query;
  })));
  const msgs = fs.map((x) => x.message).join('\n');
  assert.match(msgs, /7 should-trigger and 9 should-not-trigger/);
  assert.match(msgs, /duplicate query/);
});

test('evals: schema violations are reported when scripts/lib/schema.mjs exists', async (t) => {
  if (!HAS_SCHEMA) return t.skip('scripts/lib/schema.mjs not available yet');
  const fs = await run('evals', tree((d) => editJson(d, `${S}/evals/evals.json`, (v) => { v.extra = true; })));
  assert.ok(fs.some((x) => x.severity === 'ERROR' && /^schema:/.test(x.message)));
});

defect('skill-length', 'a 501-line SKILL.md fails', async () => {
  const fs = await run('skill-length', tree((d) => edit(d, `${S}/SKILL.md`, (s) => s + 'line\n'.repeat(500))));
  assert.match(fs[0].message, /max 500/);
});

defect('schemas-taxonomy', 'off-taxonomy category/keyword and languages without compatibility fail', async () => {
  const fs = await run('schemas-taxonomy', tree((d) => {
    editJson(d, `${P}/catalogue.json`, (v) => { v.category = 'nope'; v.languages = ['go']; });
    editJson(d, `${P}/.claude-plugin/plugin.json`, (v) => { v.keywords.push('not-a-tag'); });
  }));
  const msgs = errors(fs).map((x) => x.message).join('\n');
  assert.match(msgs, /category "nope"/);
  assert.match(msgs, /keyword "not-a-tag"/);
  assert.match(msgs, /needs a `compatibility` field/);
});

test('schemas-taxonomy: status.json schema enforced when scripts/lib/schema.mjs exists', async (t) => {
  if (!HAS_SCHEMA) return t.skip('scripts/lib/schema.mjs not available yet');
  const fs = await run('schemas-taxonomy', tree((d) => editJson(d, `${P}/status.json`, (v) => { v.since = 'yesterday'; })));
  assert.ok(fs.some((x) => x.file.endsWith('status.json') && /^schema:/.test(x.message)));
});

defect('one-plugin-per-pr', 'two changed plugins without the multi-plugin label fail', async () => {
  const head = tree((d) => {
    cpSync(join(d, P), join(d, 'plugins/demo-two'), { recursive: true });
    edit(d, `${S}/SKILL.md`, (s) => s + '\n');
  });
  const pr = { title: 'feat: x', labels: [], baseRef: 'main', headRef: 'feat/x' };
  assert.equal((await run('one-plugin-per-pr', head, { base: GOOD, pr })).length, 1);
  assert.deepEqual(await run('one-plugin-per-pr', head, { base: GOOD, pr: { ...pr, labels: ['multi-plugin'] } }), []);
});

defect('promotion', 'wrong branch, wrong title and an unlabelled rollback fail', async () => {
  const ok = { title: 'chore(stable): promote main@abc1234', labels: [], baseRef: 'stable', headRef: 'promote/2026-11-08' };
  assert.deepEqual(await run('promotion', GOOD, { base: GOOD, pr: ok }), []);
  assert.equal((await run('promotion', GOOD, { base: GOOD, pr: { ...ok, headRef: 'feat/x' } })).length, 1);
  assert.equal((await run('promotion', GOOD, { base: GOOD, pr: { ...ok, title: 'chore: promote' } })).length, 1);
  const base = tree((d) => editJson(d, `${P}/.claude-plugin/plugin.json`, (v) => { v.version = '1.2.0'; }));
  assert.match((await run('promotion', GOOD, { base, pr: ok }))[0].message, /rollback/);
  assert.deepEqual(await run('promotion', GOOD, { base, pr: { ...ok, labels: ['rollback'] } }), []);
  assert.deepEqual(await run('promotion', GOOD, { base, pr: { ...ok, baseRef: 'main' } }), []);
});

defect('pr-title', 'a non-conventional PR title fails', async () => {
  const fs = await run('pr-title', GOOD, { pr: { title: 'Update stuff', labels: [], baseRef: 'main', headRef: 'x' } });
  assert.equal(fs.length, 1);
});

test('CI-only rules do not run without --pr', async () => {
  const { ran } = await runChecks({ root: GOOD });
  for (const r of rules.filter((x) => x.ciOnly)) assert.ok(!ran.includes(r.id), r.id);
});

defect('hidden-content', 'invisible characters in a plugin file fail with file + line', async () => {
  const fs = await run('hidden-content', tree((d) => cpSync(join(MAL, 'hidden-zero-width.md'), join(d, S, 'notes.md'))));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, 'HIGH');
  assert.equal(fs[0].file, `${S}/notes.md`);
  assert.equal(fs[0].line, 3);
});

defect('patterns', 'a dangerous pattern in a plugin file fails with file + line', async () => {
  const fs = await run('patterns', tree((d) => cpSync(join(MAL, 'pipe-to-shell.md'), join(d, S, 'setup.md'))));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, 'HIGH');
  assert.equal(fs[0].line, 5);
});

// ---- stage-gate: base tree at one stage, head tree at another (GOOD is published, since 2026-11-08).
const TODAY = '2026-11-08';
const setStatus = (d, st) => editJson(d, `${P}/status.json`, () => st);
/** [base, head]: both get `both(dir)` applied, then their own status. */
function stagePair(from, to, both = () => {}) {
  const base = tree((d) => { both(d); setStatus(d, from); });
  const head = tree((d) => { both(d); setStatus(d, to); });
  return [base, head];
}
async function gate(base, head, extra = {}) {
  const r = byId['stage-gate'];
  assert.ok(r, 'rule stage-gate exists');
  const ctx = { ...buildContext({ root: head, base, pr: extra.pr ?? null }), today: TODAY, consumers: extra.consumers ?? null };
  return (await r.run(ctx)).filter((x) => x.rule === 'stage-gate');
}
const msgs = (fs) => fs.map((x) => `${x.severity} ${x.message}`).join('\n');
const row = (plugin, consumer, status = 'active') => ({ plugin, consumer, status });

defect('stage-gate', 'a new plugin that does not start at sandbox fails', async () => {
  const base = tree((d) => rmSync(join(d, P), { recursive: true }));
  const fs = await gate(base, GOOD);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, 'ERROR');
  assert.match(fs[0].message, /new plugin must start at `sandbox` \(got published\)/);
  assert.deepEqual(await gate(base, tree((d) => setStatus(d, { stage: 'sandbox', since: TODAY }))), []);
  assert.deepEqual(await gate(GOOD, GOOD), []); // no stage change → nothing to gate
});

test('stage-gate: jumping sandbox → published fails (one step at a time)', async () => {
  const [base, head] = stagePair({ stage: 'sandbox', since: '2026-01-01' }, { stage: 'published', since: TODAY });
  assert.match(msgs(await gate(base, head)), /sandbox → published is not allowed.*one step at a time/);
  const [b2, h2] = stagePair({ stage: 'published', since: '2026-01-01' }, { stage: 'incubating', since: TODAY });
  assert.match(msgs(await gate(b2, h2)), /published → incubating is not allowed/);
});

test('stage-gate: a stage-change PR may change only status.json + generated catalogues', async () => {
  const [base, head] = stagePair({ stage: 'published', since: '2026-01-01' }, { stage: 'deprecated', since: TODAY, reason: 'superseded' });
  assert.deepEqual(await gate(base, head), []);
  edit(head, '.claude-plugin/marketplace.json', (s) => s.replace('"plugins"', '"plugins" ')); // generated: allowed
  assert.deepEqual(await gate(base, head), []);
  edit(head, `${S}/SKILL.md`, (s) => s + '\nmore\n');
  writeFileSync(join(head, 'taxonomy.json'), readFileSync(join(head, 'taxonomy.json'), 'utf8') + '\n');
  const m = msgs(await gate(base, head));
  assert.match(m, /may change only .*status\.json/);
  assert.match(m, /SKILL\.md/);
  assert.match(m, /taxonomy\.json/);
});

test('stage-gate: sandbox → incubating needs evals + trigger set, an owner and no HIGH findings', async () => {
  const from = { stage: 'sandbox', since: '2026-01-01' };
  const to = { stage: 'incubating', since: TODAY };
  assert.deepEqual(await gate(...stagePair(from, to)), []);
  const m = msgs(await gate(...stagePair(from, to, (d) => {
    rmSync(join(d, S, 'evals/trigger-evals.json'));
    editJson(d, `${P}/catalogue.json`, (v) => { v.owner = ' '; });
    cpSync(join(MAL, 'pipe-to-shell.md'), join(d, S, 'setup.md'));
  })));
  assert.match(m, /ERROR .*trigger-evals\.json/);
  assert.match(m, /ERROR .*owner/);
  assert.match(m, /ERROR .*HIGH finding.*setup\.md:5/);
});

test('stage-gate: incubating → published needs 14 days or 2 active consumers, and a CHANGELOG entry', async () => {
  const to = { stage: 'published', since: TODAY };
  const young = stagePair({ stage: 'incubating', since: '2026-11-01' }, to);
  assert.match(msgs(await gate(...young)), /incubating for 7 days.*14.*active consumers: unknown/);
  const two = [row('demo-plugin', 'org/a'), row('demo-plugin', 'org/b'), row('demo-plugin', 'org/c', 'stale'), row('other', 'org/d')];
  assert.deepEqual(await gate(...young, { consumers: two }), []);
  assert.match(msgs(await gate(...young, { consumers: two.slice(1) })), /1 active consumer/);
  assert.deepEqual(await gate(...stagePair({ stage: 'incubating', since: '2026-10-25' }, to)), []);
  const noLog = stagePair({ stage: 'incubating', since: '2026-01-01' }, to, (d) => editJson(d, `${P}/.claude-plugin/plugin.json`, (v) => { v.version = '1.1.0'; }));
  assert.match(msgs(await gate(...noLog)), /CHANGELOG\.md has no entry for 1\.1\.0/);
});

test('stage-gate: → deprecated needs replacedBy or a reason', async () => {
  const from = { stage: 'published', since: '2026-01-01' };
  assert.match(msgs(await gate(...stagePair(from, { stage: 'deprecated', since: TODAY }))), /replacedBy.*or a `reason`/);
  assert.deepEqual(await gate(...stagePair(from, { stage: 'deprecated', since: TODAY }, (d) => editJson(d, `${P}/catalogue.json`, (v) => { v.replacedBy = 'new-plugin'; }))), []);
  assert.deepEqual(await gate(...stagePair({ stage: 'incubating', since: TODAY }, { stage: 'deprecated', since: TODAY, reason: 'abandoned' })), []);
});

test('stage-gate: → retired needs no active consumers unless labelled retire-anyway', async () => {
  const pair = stagePair({ stage: 'deprecated', since: '2026-01-01', reason: 'x' }, { stage: 'retired', since: TODAY, reason: 'x' });
  assert.match(msgs(await gate(...pair, { consumers: [row('demo-plugin', 'org/a')] })), /1 active consumer.*org\/a.*retire-anyway/);
  assert.match(msgs(await gate(...pair)), /consumer data unavailable/);
  assert.deepEqual(await gate(...pair, { consumers: [row('demo-plugin', 'org/a', 'stale')] }), []);
  const pr = { title: 'chore(demo-plugin): retire', labels: ['retire-anyway'], baseRef: 'main', headRef: 'x' };
  assert.deepEqual(await gate(...pair, { consumers: [row('demo-plugin', 'org/a')], pr }), []);
});

test('version-bump: a status.json-only change needs no version bump', async () => {
  const head = tree((d) => setStatus(d, { stage: 'deprecated', since: TODAY, reason: 'r' }));
  assert.deepEqual(await run('version-bump', head, { base: GOOD }), []);
});

test('every rule module has a seeded-defect test (deleting a rule fails here)', () => {
  const EXPECTED = ['changelog-entry', 'evals', 'hidden-content', 'name-consistency', 'one-plugin-per-pr', 'patterns', 'pr-title',
    'promotion', 'schemas-taxonomy', 'skill-frontmatter', 'skill-length', 'stage-gate', 'stale-catalogues', 'structure', 'version-bump'];
  assert.deepEqual(rules.map((r) => r.id).sort(), EXPECTED);
  for (const r of rules) {
    assert.ok(covered.has(r.id), `rule ${r.id} has no seeded-defect test`);
    assert.ok(['plugins', 'security'].includes(r.group), `${r.id} group`);
  }
});
