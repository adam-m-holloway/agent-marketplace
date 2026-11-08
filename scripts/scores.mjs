#!/usr/bin/env node
// Per-plugin scores (security, quality, evals, adoption) and their history on the data branch.
//   node scripts/scores.mjs --compare --base <dir> [--root <dir>]       PR preview table (informational)
//   node scripts/scores.mjs --record --data <dir> [--root .] [--skillspector <json>] [--quality <dir>] [--now <iso>]
//   node scripts/scores.mjs --backfill --data <dir> [--root .]          one record per existing tag
//   node scripts/scores.mjs --collect-skillspector <dir>                SkillSpector reports → {plugin: risk}
// Scores are computed from files and saved tool reports only (no network). --quality <dir> is the
// output of scripts/quality-tools.sh; without it the tool-based quality parts are "not run".
// History is kept for major/minor versions only.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRepo, stableJson } from './lib/plugins.mjs';
import { parse, compare } from './lib/semver.mjs';
import hiddenContent from './lib/rules/hidden-content.mjs';
import patterns from './lib/rules/patterns.mjs';
import { BEST_PRACTICE_RULES, bestPracticeScore } from './lib/best-practice.mjs';

export const SECURITY_PENALTY = { HIGH: 40, MEDIUM: 10 };

/**
 * Docs hygiene decay constant: score = round(100 × e^(−k × findings per 100 lines)). k = 0.1 puts
 * 1 finding per 100 lines at 90, 2 at 82, 3 at 74 and 5 at 61, so "a few issues" lands in the 70s–80s.
 */
export const DOCS_K = 0.1;
/** Stored with each history record; quality changes are only shown between records scored the same way. */
export const QUALITY_METHOD = 'static-tools-v1';

export const QUALITY_TOOLS = [
  { id: 'skill-check', name: 'skill-check', url: 'https://github.com/thedaviddias/skill-check', license: 'MIT' },
  { id: 'skillscore', name: 'skillscore', url: 'https://github.com/sayed3li97/skillscore', license: 'Apache-2.0' },
  { id: 'best-practices', name: 'Anthropic skill authoring best practices', url: 'https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices', license: null },
  { id: 'markdownlint', name: 'markdownlint-cli2', url: 'https://github.com/DavidAnson/markdownlint-cli2', license: 'MIT' },
  { id: 'lychee', name: 'lychee', url: 'https://github.com/lycheeverse/lychee', license: 'MIT OR Apache-2.0' },
  { id: 'cspell', name: 'cspell', url: 'https://github.com/streetsidesoftware/cspell', license: 'MIT' },
];

export const QUALITY_CRITERIA = [
  { id: 'linters', weight: 55, label: 'Skill linters: the mean of skill-check and skillscore (each 0–100 per skill, averaged over the plugin\'s skills)' },
  { id: 'best-practice', weight: 25, label: `Anthropic best-practice rules (our own deterministic checker): share of the ${BEST_PRACTICE_RULES.length} checks per skill passed` },
  { id: 'docs', weight: 20, label: `Docs hygiene: markdownlint-cli2, lychee (offline, local links) and cspell over the plugin's .md files; round(100 × e^(−${DOCS_K} × findings per 100 lines))` },
];

export const SCORES_EXPLAINED = {
  bands: 'Meters: 90–100 good, 70–89 fair, below 70 poor. Each score is shown separately; there is no overall score.',
  security: [
    'Starts at 100.',
    `−${SECURITY_PENALTY.HIGH} per HIGH and −${SECURITY_PENALTY.MEDIUM} per MEDIUM finding from this repo's own hidden-content and patterns rules (rules/patterns.json), run on the plugin's files.`,
    'When SkillSpector (--no-llm, pinned) ran for the site build, security = min(rules score, 100 − SkillSpector risk). "SkillSpector: not run" means the scan was unavailable and only our rules count.',
    'Floored at 0.',
  ],
  quality: [
    'Static, free, open-source tools only; no model calls. A weighted sum of three parts:',
    ...QUALITY_CRITERIA.map((c) => `${c.weight}% — ${c.label}.`),
    `Best-practice rules checked: ${BEST_PRACTICE_RULES.map((r) => r.label.replace(/ \(.*\)$/, '')).join('; ')}.`,
    `Docs hygiene uses k = ${DOCS_K}: 0 findings per 100 lines scores 100, 1 scores 90, 2 → 82, 3 → 74, 5 → 61.`,
    'The tools run (pinned versions) when the site is built and at each release. A part whose tool did not run is shown as "not run" and the other parts are re-weighted; it never counts as passed.',
    'Presence checks (eval cases, trigger sets, README and CHANGELOG, taxonomy keywords, compatibility, SKILL.md length) are npm run check gates, not points.',
  ],
  quality_tools: QUALITY_TOOLS,
  evals: [
    'Measured, not computed: the overall score of the latest `claude plugin eval` run in evals/results.json (mean case score with the plugin, as a percentage; each case also runs without the plugin). Older runs (skill-creator style) count passed expectations instead.',
    'Delta is the score with the plugin minus the score without it (mean delta across cases), in percentage points.',
    'A run is only used for versions at or after the version it measured; if the plugin has changed since, the card says "measured on an earlier version".',
  ],
  adoption: [
    'Counts repos that install the plugin (listed in their .claude/settings.json); it does not measure how often the skills are used.',
    'Source: the nightly insights scan of the team repos in insights/consumers.json.',
  ],
  tracking: [
    'History is kept for major and minor versions only: a release is recorded when it is the plugin\'s first version, or its major.minor is higher than the last recorded one. Patch releases (x.y.z with z > 0) are not recorded; they still refresh the current scores (shown as "patch, not tracked").',
    '"▲/▼ n" on a card compares the current scores with the previous recorded (major/minor) version. If that record has no SkillSpector risk, the security change uses our rules only, so like is compared with like. Quality changes are only shown against records scored the same way.',
  ],
  recording: [
    'Pull requests: the pr-gate plugins job prints a "Score changes" table (base → PR) in the job summary. Informational only; it never fails the PR.',
    'Releases: after each <plugin>--v<version> tag, release.yml scores that tag and appends a record to the data branch.',
    'Where: data branch, scores/year=YYYY/month=MM/YYYY-MM-DD.ndjson (one JSON record per line, recorded_at in UTC) and latest/scores.json (current scores per plugin).',
  ],
};

// ---------------------------------------------------------------- pure scoring

export const band = (n) => (n == null ? 'none' : n >= 90 ? 'good' : n >= 70 ? 'fair' : 'poor');

/** Security score from rule findings and an optional SkillSpector risk (0–100, null = not run). */
export function securityScore(findings, skillspectorRisk = null) {
  const high = findings.filter((x) => x.severity === 'HIGH' || x.severity === 'ERROR').length;
  const medium = findings.filter((x) => x.severity === 'MEDIUM').length;
  const rules = Math.max(0, 100 - SECURITY_PENALTY.HIGH * high - SECURITY_PENALTY.MEDIUM * medium);
  const risk = typeof skillspectorRisk === 'number' && Number.isFinite(skillspectorRisk) ? Math.min(100, Math.max(0, skillspectorRisk)) : null;
  const score = risk === null ? rules : Math.min(rules, 100 - risk);
  const inputs = `${high} HIGH, ${medium} MEDIUM; SkillSpector ${risk === null ? 'not run' : `risk ${risk}/100`}`;
  return { score, rules_score: rules, high, medium, skillspector_risk: risk, inputs };
}

// ---------------------------------------------------------------- quality: tool report parsers (pure)

const skillDirOf = (p) => (typeof p === 'string' ? basename(dirname(p)) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** skill-check JSON → {skillFolder: 0–100}. */
export function skillCheckScores(report) {
  const out = {};
  for (const s of Array.isArray(report?.scores) ? report.scores : []) {
    const name = skillDirOf(s?.relativePath) ?? String(s?.skillId ?? '').split('/').at(-1);
    if (name && typeof s.score === 'number') out[name] = s.score;
  }
  return out;
}

/** skillscore JSON → {skillFolder: 0–100}. */
export function skillscoreScores(report) {
  const out = {};
  for (const s of Array.isArray(report?.skills) ? report.skills : []) {
    const name = skillDirOf(s?.path) ?? s?.name;
    if (name && typeof s.score === 'number') out[name] = s.score;
  }
  return out;
}

/** markdownlint-cli2 text output → number of findings (`file:line[:col] [error] MDnnn/...`), null if it did not run. */
export function markdownlintCount(text) {
  if (typeof text !== 'string' || !/^Summary: /m.test(text)) return null;
  return text.split('\n').filter((l) => /^\S+:\d+(?::\d+)?\s+(?:\w+\s+)?MD\d{3}\//.test(l)).length;
}

/** lychee --format json → number of broken links, null if unreadable. */
export const lycheeCount = (report) => (typeof report?.errors === 'number' ? report.errors : null);

/** cspell text output → number of unknown words, null if it did not run (or could not read its config). */
export function cspellCount(text) {
  if (typeof text !== 'string') return null;
  const summary = /^CSpell: Files checked: \d+, Issues found: \d+ in \d+ files?(.*)$/m.exec(text);
  if (!summary || /with \d+ errors?/.test(summary[1])) return null;
  return text.split('\n').filter((l) => / - Unknown word \(/.test(l)).length;
}

/** Docs hygiene 0–100 from findings and markdown lines: round(100 × e^(−k × findings per 100 lines)). */
export function docsHygieneScore(findings, lines, k = DOCS_K) {
  if (!lines) return 100;
  return Math.round(100 * Math.exp((-k * 100 * findings) / lines));
}

/** Weighted mean over the components that ran (score !== null), re-weighted to 100; null if none ran. */
export function weightedQuality(components) {
  const ran = components.filter((c) => typeof c.score === 'number');
  const w = ran.reduce((n, c) => n + c.weight, 0);
  return w ? Math.round(ran.reduce((n, c) => n + c.weight * c.score, 0) / w) : null;
}

const TOOL_FILES = { 'skill-check': 'json', skillscore: 'json', markdownlint: 'txt', lychee: 'json', cspell: 'txt' };

/**
 * Raw reports written by scripts/quality-tools.sh → {plugin: {tool: parsed JSON | text}}.
 * null when the directory does not exist (no tool ran). Unreadable reports are left out (= not run).
 */
export function readQualityReports(dir) {
  if (!dir || !existsSync(dir)) return null;
  const out = {};
  for (const [tool, ext] of Object.entries(TOOL_FILES)) {
    const d = join(dir, tool);
    for (const f of existsSync(d) ? readdirSync(d).filter((x) => x.endsWith(`.${ext}`)) : []) {
      const plugin = f.slice(0, -ext.length - 1);
      try {
        const text = readFileSync(join(d, f), 'utf8');
        (out[plugin] ??= {})[tool] = ext === 'json' ? JSON.parse(text) : text;
      } catch { /* not run */ }
    }
  }
  return out;
}

// ---------------------------------------------------------------- quality score

const isEvalPath = (f) => /(^|\/)evals\//.test(f);
const readOrNull = (root, rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; } };
const countLines = (t) => (t ? t.replace(/\n$/, '').split('\n').length : 0);

/** The plugin's markdown files that the docs tools lint (everything but evals/). */
export const docFiles = (plugin) => (plugin.files ?? []).filter((f) => f.endsWith('.md') && !isEvalPath(f.slice(plugin.path.length + 1)));

/** Each skill with its other markdown files (references etc., not evals), for the best-practice checker. */
function skillsWithFiles(root, plugin) {
  return (plugin.skills ?? []).map((s) => {
    const files = {};
    for (const f of plugin.files ?? []) {
      if (!f.startsWith(`${s.path}/`) || !f.endsWith('.md')) continue;
      const rel = f.slice(s.path.length + 1);
      if (rel === 'SKILL.md' || isEvalPath(rel)) continue;
      const t = readOrNull(root, f);
      if (t !== null) files[rel] = t;
    }
    return { name: s.name, skillMd: s.skillMd, files };
  });
}

function lintersComponent(plugin, reports) {
  const names = (plugin.skills ?? []).map((s) => s.name);
  const per = (tool, parse) => {
    if (!reports?.[tool]) return { tool, score: null, detail: `${tool}: not run` };
    const m = parse(reports[tool]);
    const got = names.filter((n) => typeof m[n] === 'number');
    if (!got.length) return { tool, score: null, detail: `${tool}: no skills scored` };
    const score = Math.round(mean(got.map((n) => m[n])));
    return { tool, score, detail: `${tool} ${score} (${got.map((n) => `${n} ${m[n]}`).join(', ')})` };
  };
  const parts = [per('skill-check', skillCheckScores), per('skillscore', skillscoreScores)];
  const ran = parts.filter((p) => p.score !== null);
  return {
    score: ran.length ? Math.round(mean(ran.map((p) => p.score))) : null,
    detail: parts.map((p) => p.detail).join('; '),
    parts: Object.fromEntries(parts.map((p) => [p.tool, p.score])),
  };
}

function docsComponent(root, plugin, reports) {
  const counts = {
    markdownlint: markdownlintCount(reports?.markdownlint),
    lychee: lycheeCount(reports?.lychee),
    cspell: cspellCount(reports?.cspell),
  };
  const ran = Object.entries(counts).filter(([, n]) => n !== null);
  const lines = docFiles(plugin).reduce((n, f) => n + countLines(readOrNull(root, f)), 0);
  if (!ran.length) return { score: null, detail: 'markdownlint-cli2, lychee, cspell: not run', parts: { ...counts, lines } };
  const findings = ran.reduce((n, [, c]) => n + c, 0);
  const per100 = lines ? Math.round((1000 * findings) / lines) / 10 : 0;
  const tools = Object.entries(counts).map(([t, n]) => `${t} ${n === null ? 'not run' : n}`).join(', ');
  return {
    score: docsHygieneScore(findings, lines),
    detail: `${tools}: ${findings} finding${findings === 1 ? '' : 's'} in ${lines} lines (${per100} per 100 lines)`,
    parts: { ...counts, lines },
  };
}

/**
 * Quality 0–100 from static tools. `reports` = this plugin's entry from readQualityReports() (or null
 * when the tools did not run). Components that did not run are marked and the rest re-weighted.
 * @returns {{score:number|null, max:100, method:string, criteria:{id,label,weight,score,ran,detail,parts?}[]}}
 */
export function qualityScore(plugin, { root, reports = null } = {}) {
  const bp = bestPracticeScore(skillsWithFiles(root, plugin));
  const results = {
    linters: lintersComponent(plugin, reports),
    'best-practice': { score: bp.score, detail: bp.detail, parts: { passed: bp.passed, total: bp.total } },
    docs: docsComponent(root, plugin, reports),
  };
  const criteria = QUALITY_CRITERIA.map((c) => ({ ...c, ...results[c.id], ran: results[c.id].score !== null }));
  return { score: weightedQuality(criteria), max: 100, method: QUALITY_METHOD, criteria };
}

const pct = (r) => (r && r.total > 0 ? Math.round((1000 * r.passed) / r.total) / 10 : null);

/**
 * Latest measured eval run for `plugin` at or before `version` (a run on a newer version than the
 * one scored says nothing about it). null when there is none.
 */
export function evalsFor(results, plugin, version) {
  const runs = (Array.isArray(results?.runs) ? results.runs : Array.isArray(results) ? results : [])
    .filter((r) => r?.plugin === plugin && parse(r.version) && (!version || !parse(version) || compare(r.version, version) <= 0))
    .sort((a, b) => compare(a.version, b.version) || String(a.measured_at).localeCompare(String(b.measured_at)));
  const r = runs.at(-1);
  if (!r) return null;
  const r1 = (v) => Math.round(v * 10) / 10;
  // Native runs (scripts/eval.mjs): overall_score and mean_delta are 0..1 over cases.
  const native = typeof r.overall_score === 'number';
  const pass = native ? r1(r.overall_score * 100) : pct(r.with_skill);
  const delta = native ? (typeof r.mean_delta === 'number' ? r1(r.mean_delta * 100) : null) : null;
  const base = native ? (delta == null ? null : r1(pass - delta)) : pct(r.baseline);
  return {
    pass_rate: pass,
    baseline_pass_rate: base,
    delta: native ? delta : pass != null && base != null ? r1(pass - base) : null,
    passed: native ? r.cases_passed ?? null : r.with_skill?.passed ?? null,
    total: native ? r.cases_total ?? null : r.with_skill?.total ?? null,
    baseline_passed: native ? null : r.baseline?.passed ?? null,
    unit: native ? 'cases' : 'expectations',
    measured_at: r.measured_at ?? null,
    measured_version: r.version,
    earlier_version: !!version && compare(r.version, version) < 0,
    method: r.method ?? null,
  };
}

/** Active consumers (distinct repos with status "active", or no status) from data.json consumer rows. */
export function adoption(consumers) {
  const active = new Set((consumers ?? []).filter((c) => !c.status || c.status === 'active').map((c) => c.consumer ?? c.team).filter(Boolean));
  return { active_consumers: active.size };
}

/** Run our hidden-content + patterns rules on one plugin. */
export function securityFindings(root, repo, plugin) {
  const ctx = { root, repo: { ...repo, plugins: [plugin] } };
  return [...hiddenContent.run(ctx), ...patterns.run(ctx)];
}

/** All scores for one plugin of a loaded repo (reads files under root; no network). */
export function scorePlugin({ root, repo, plugin, evalsResults = null, skillspector = null, consumers = null, qualityReports = null }) {
  const risk = skillspector && typeof skillspector[plugin.dir] === 'number' ? skillspector[plugin.dir] : null;
  const out = {
    security: securityScore(securityFindings(root, repo, plugin), risk),
    quality: qualityScore(plugin, { root, reports: qualityReports?.[plugin.dir] ?? null }),
    evals: evalsFor(evalsResults, plugin.dir, plugin.manifest?.version ?? null),
  };
  if (consumers) out.adoption = adoption(consumers);
  return out;
}

export function readEvalsResults(root) {
  try { return JSON.parse(readFileSync(join(root, 'evals/results.json'), 'utf8')); } catch { return null; }
}

/** SkillSpector JSON reports ({file name → parsed report}) → {plugin: risk}. Unreadable reports are skipped. */
export function skillspectorMap(reports) {
  const out = {};
  for (const [file, rep] of Object.entries(reports)) {
    const score = rep?.risk_assessment?.score;
    const name = file.replace(/\.json$/, '');
    if (typeof score === 'number' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) out[name] = score;
  }
  return out;
}

export function readSkillspector(file) {
  if (!file) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- tracking (major/minor only)

const majorMinor = (v) => { const p = parse(v); return p ? p.major * 1e6 + p.minor : null; };

/**
 * Is `version` recorded in history? Yes for a plugin's first version, or when its major.minor is
 * higher than the last recorded version's. Patches (same major.minor) are not tracked.
 */
export function isTracked(version, lastTracked) {
  if (!parse(version)) return { tracked: false, reason: 'invalid version' };
  if (!lastTracked) return { tracked: true, reason: 'first' };
  const a = majorMinor(version), b = majorMinor(lastTracked);
  if (a > b) return { tracked: true, reason: parse(version).major > parse(lastTracked).major ? 'major' : 'minor' };
  return { tracked: false, reason: a === b ? 'patch' : 'older' };
}

/** History record (data-branch shape) from a scorePlugin() result. */
export function historyRecord({ recordedAt, plugin, version, tag, commitSha, scores, skillspectorNote = null }) {
  const e = scores.evals;
  return {
    recorded_at: recordedAt,
    plugin,
    version,
    tag,
    commit_sha: commitSha,
    security: scores.security.score,
    security_inputs: scores.security.inputs,
    quality: scores.quality.score,
    quality_method: scores.quality.method,
    quality_criteria: scores.quality.criteria.map(({ id, weight, score, ran, detail }) => ({ id, weight, score, ran, detail })),
    ...(e ? { evals: { pass_rate: e.pass_rate, baseline_pass_rate: e.baseline_pass_rate, measured_at: e.measured_at, measured_version: e.measured_version } } : {}),
    skillspector_risk: scores.security.skillspector_risk,
    ...(scores.security.skillspector_risk === null ? { skillspector_note: skillspectorNote ?? 'SkillSpector not run' } : {}),
  };
}

export const parseNdjson = (text) => String(text ?? '').split('\n').filter((l) => l.trim()).flatMap((l) => {
  try { return [JSON.parse(l)]; } catch { return []; }
});

/** Every history record under <dataDir>/scores/year=*\/month=*\/*.ndjson. */
export function readHistory(dataDir) {
  const base = join(dataDir, 'scores');
  if (!existsSync(base)) return [];
  const out = [];
  for (const y of readdirSync(base).filter((d) => d.startsWith('year=')).sort()) {
    for (const m of readdirSync(join(base, y)).filter((d) => d.startsWith('month=')).sort()) {
      for (const f of readdirSync(join(base, y, m)).filter((x) => x.endsWith('.ndjson')).sort()) {
        out.push(...parseNdjson(readFileSync(join(base, y, m, f), 'utf8')));
      }
    }
  }
  return out;
}

/** Highest recorded version for a plugin in history (optionally below `below`), or null. */
export function lastTrackedVersion(history, plugin, below = null) {
  const vs = history.filter((r) => r.plugin === plugin && parse(r.version) && (!below || compare(r.version, below) < 0)).map((r) => r.version);
  return vs.sort(compare).at(-1) ?? null;
}

export const historyPath = (recordedAt) => {
  const day = recordedAt.slice(0, 10);
  return join('scores', `year=${day.slice(0, 4)}`, `month=${day.slice(5, 7)}`, `${day}.ndjson`);
};

/**
 * Pure plan: given history, latest doc and scored candidates (sorted by plugin then version),
 * decide which records to append and the new latest/scores.json. Idempotent.
 * @param candidates {{record:object}[]} history-shaped records
 */
export function planRecords(history, latestDoc, candidates, now) {
  const hist = [...history];
  const latest = { ...(latestDoc?.plugins ?? {}) };
  const append = [];
  for (const { record } of candidates) {
    const known = hist.some((r) => r.tag === record.tag);
    const t = isTracked(record.version, lastTrackedVersion(hist, record.plugin, record.version));
    if (t.tracked && !known) { append.push(record); hist.push(record); }
    const cur = latest[record.plugin];
    // Newer version wins; the same version is upgraded once SkillSpector data arrives
    // (e.g. a backfilled entry), but never downgraded to an entry without it.
    const upgrade = cur && compare(record.version, cur.version) === 0
      && cur.skillspector_risk == null && record.skillspector_risk != null;
    if (!cur || compare(record.version, cur.version) > 0 || upgrade) {
      latest[record.plugin] = { ...record, tracked: t.tracked || known, ...(t.tracked || known ? {} : { reason: t.reason }) };
    }
  }
  const changed = append.length > 0 || JSON.stringify(latest) !== JSON.stringify(latestDoc?.plugins ?? {});
  return { append, latest: { updated_at: changed ? now : latestDoc?.updated_at ?? now, plugins: sortKeys(latest) }, changed };
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

export function writeRecords(dataDir, plan) {
  for (const r of plan.append) {
    const file = join(dataDir, historyPath(r.recorded_at));
    mkdirSync(join(file, '..'), { recursive: true });
    appendFileSync(file, JSON.stringify(r) + '\n');
  }
  if (plan.changed) {
    mkdirSync(join(dataDir, 'latest'), { recursive: true });
    writeFileSync(join(dataDir, 'latest/scores.json'), stableJson(plan.latest));
  }
}

// ---------------------------------------------------------------- deltas + PR preview

/**
 * Change of current scores vs a previous history record: {security, quality, evals} in points,
 * null if unknown. Like for like: when the previous record had no SkillSpector risk, the current
 * rules-only security score is compared (security_basis "rules only").
 */
export function scoreChange(current, previous) {
  if (!previous) return null;
  const d = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.round((a - b) * 10) / 10 : null);
  const rulesOnly = previous.skillspector_risk == null && typeof current.security?.rules_score === 'number';
  return {
    vs_version: previous.version,
    security: d(rulesOnly ? current.security.rules_score : current.security?.score, previous.security),
    security_basis: rulesOnly ? 'rules only' : 'rules + SkillSpector',
    // Only like for like: a record scored with another quality method (or none) gives no change.
    quality: (previous.quality_method ?? null) === (current.quality?.method ?? null) ? d(current.quality?.score, previous.quality) : null,
    evals: d(current.evals?.pass_rate, previous.evals?.pass_rate),
  };
}

const METRICS = [
  ['security', (s) => s.security.score],
  ['quality', (s) => s.quality.score],
  ['evals pass rate', (s) => s.evals?.pass_rate ?? null],
];

/** Rows {plugin, metric, base, pr, delta} for every metric that differs (new/removed plugins included). */
export function compareScores(baseScores, prScores) {
  const rows = [];
  for (const name of [...new Set([...Object.keys(baseScores), ...Object.keys(prScores)])].sort()) {
    for (const [metric, get] of METRICS) {
      const b = baseScores[name] ? get(baseScores[name]) : null;
      const p = prScores[name] ? get(prScores[name]) : null;
      if (b === p) continue;
      rows.push({ plugin: name, metric, base: b, pr: p, delta: typeof b === 'number' && typeof p === 'number' ? Math.round((p - b) * 10) / 10 : null });
    }
  }
  return rows;
}

export function formatCompare(rows) {
  const v = (x) => (x === null ? '—' : String(x));
  const lines = ['### Score changes', ''];
  if (!rows.length) return [...lines, 'No score changes.', ''].join('\n');
  lines.push('| plugin | metric | base → PR | delta |', '| --- | --- | --- | --- |');
  for (const r of rows) lines.push(`| ${r.plugin} | ${r.metric} | ${v(r.base)} → ${v(r.pr)} | ${r.delta === null ? '—' : (r.delta > 0 ? '+' : '') + r.delta} |`);
  lines.push('', 'Informational only (SkillSpector risk is not included here). How scores are calculated: see the catalogue site.', '');
  return lines.join('\n');
}

export function scoreTree(root) {
  const repo = loadRepo(root);
  const evalsResults = readEvalsResults(root);
  const out = {};
  for (const p of repo.plugins) out[p.dir] = scorePlugin({ root, repo, plugin: p, evalsResults });
  return out;
}

// ---------------------------------------------------------------- git helpers (CLI only)

const git = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

export function releaseTags(root) {
  const r = git(root, 'tag', '--list', '*--v*');
  return r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

export const splitTag = (tag) => { const m = /^(.+)--v(\d+\.\d+\.\d+)$/.exec(tag); return m ? { plugin: m[1], version: m[2] } : null; };

/** Extract a tag's tree into a temp dir (caller removes it). */
function extractTag(root, tag) {
  const dir = mkdtempSync(join(tmpdir(), 'scores-tag-'));
  const tar = spawnSync('git', ['-C', root, 'archive', '--format=tar', tag], { maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`git archive ${tag} failed: ${tar.stderr}`);
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout });
  if (x.status !== 0) throw new Error(`tar -x failed: ${x.stderr}`);
  return dir;
}

/** Score one tag's tree. Evals come from the CURRENT evals/results.json (runs are versioned). */
function scoreTag(root, tag, { recordedAt, skillspector, skillspectorNote, evalsResults, qualityReports }) {
  const { plugin, version } = splitTag(tag);
  const dir = extractTag(root, tag);
  try {
    const repo = loadRepo(dir);
    const p = repo.plugins.find((x) => x.dir === plugin);
    if (!p) return null;
    const scores = scorePlugin({ root: dir, repo, plugin: p, evalsResults, skillspector, qualityReports });
    const commitSha = git(root, 'rev-list', '-n', '1', tag).stdout.trim();
    const at = recordedAt ?? git(root, 'log', '-1', '--format=%cI', tag).stdout.trim();
    return { record: historyRecord({ recordedAt: new Date(at).toISOString(), plugin, version, tag, commitSha, scores, skillspectorNote }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const byPluginVersion = (a, b) => a.plugin.localeCompare(b.plugin) || compare(a.version, b.version);

export function main(argv = process.argv.slice(2), log = console.log) {
  const opt = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--compare', '--record', '--backfill'].includes(a)) opt.mode = a.slice(2);
    else if (['--base', '--root', '--data', '--skillspector', '--quality', '--now', '--collect-skillspector'].includes(a)) opt[a.slice(2)] = argv[++i];
    else { log(`unknown argument: ${a}`); return 2; }
  }
  opt.root = resolve(opt.root);

  if (opt['collect-skillspector']) {
    const dir = opt['collect-skillspector'];
    const reports = {};
    for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
      try { reports[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { /* skip */ }
    }
    log(JSON.stringify(skillspectorMap(reports), null, 2));
    return 0;
  }

  if (opt.mode === 'compare') {
    if (!opt.base) { log('--compare needs --base <dir>'); return 2; }
    const md = formatCompare(compareScores(scoreTree(resolve(opt.base)), scoreTree(opt.root)));
    log(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    return 0;
  }

  if (opt.mode === 'record' || opt.mode === 'backfill') {
    if (!opt.data) { log(`--${opt.mode} needs --data <dir>`); return 2; }
    const data = resolve(opt.data);
    const tags = new Set(releaseTags(opt.root));
    const evalsResults = readEvalsResults(opt.root);
    let wanted;
    if (opt.mode === 'backfill') {
      wanted = [...tags].filter(splitTag);
    } else {
      // The current version's tag of every plugin (release.yml runs after tagging).
      wanted = loadRepo(opt.root).plugins.map((p) => `${p.dir}--v${p.manifest?.version}`).filter((t) => tags.has(t));
    }
    const skillspector = opt.mode === 'record' ? readSkillspector(opt.skillspector) : null;
    // Tool reports are for the current tree; a release tag's plugin files equal it (every change bumps the version).
    const qualityReports = opt.mode === 'record' ? readQualityReports(opt.quality ? resolve(opt.quality) : null) : null;
    const note = opt.mode === 'backfill' ? 'SkillSpector not run (backfill)' : skillspector ? null : 'SkillSpector not run (install or scan failed)';
    const now = opt.now ?? new Date().toISOString();
    const candidates = wanted.map(splitTag).sort(byPluginVersion)
      .map(({ plugin, version }) => scoreTag(opt.root, `${plugin}--v${version}`, {
        recordedAt: opt.mode === 'record' ? now : null, skillspector, skillspectorNote: note, evalsResults, qualityReports,
      }))
      .filter(Boolean);
    let latestDoc = null;
    try { latestDoc = JSON.parse(readFileSync(join(data, 'latest/scores.json'), 'utf8')); } catch { /* first run */ }
    const plan = planRecords(readHistory(data), latestDoc, candidates, now);
    writeRecords(data, plan);
    log(`scores ${opt.mode}: ${candidates.length} tag(s) scored, ${plan.append.length} history record(s) appended` +
      `${plan.append.length ? ` (${plan.append.map((r) => r.tag).join(', ')})` : ''}; latest/scores.json ${plan.changed ? 'updated' : 'unchanged'}`);
    return 0;
  }

  log('usage: scores.mjs --compare --base <dir> [--root <dir>] | --record --data <dir> [--skillspector <json>] [--quality <dir>] | --backfill --data <dir> | --collect-skillspector <dir>');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
