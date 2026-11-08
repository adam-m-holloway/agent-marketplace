#!/usr/bin/env node
// Per-plugin scores (security, quality, evals, adoption) and their history on the data branch.
//   node scripts/scores.mjs --compare --base <dir> [--root <dir>]       PR preview table (informational)
//   node scripts/scores.mjs --record --data <dir> [--root .] [--skillspector <json>] [--now <iso>]
//   node scripts/scores.mjs --backfill --data <dir> [--root .]          one record per existing tag
//   node scripts/scores.mjs --collect-skillspector <dir>                SkillSpector reports → {plugin: risk}
// Scores are computed from files only (no network). History is kept for major/minor versions only.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRepo, stableJson } from './lib/plugins.mjs';
import { parse, compare } from './lib/semver.mjs';
import hiddenContent from './lib/rules/hidden-content.mjs';
import patterns from './lib/rules/patterns.mjs';
import { MIN_CASES, MIN_TRIGGER_EACH } from './lib/rules/evals.mjs';
import { MAX_LINES } from './lib/rules/skill-length.mjs';

export const SECURITY_PENALTY = { HIGH: 40, MEDIUM: 10 };
export const MAX_DESCRIPTION = 1024;

export const QUALITY_CRITERIA = [
  { id: 'evals', weight: 20, label: `At least ${MIN_CASES} eval cases per skill` },
  { id: 'triggers', weight: 15, label: `Trigger set has at least ${MIN_TRIGGER_EACH} should-trigger and ${MIN_TRIGGER_EACH} should-not-trigger queries per skill` },
  { id: 'description', weight: 20, label: `Each skill description says what it does, when to use it, example triggers and what it is not for (heuristic), within ${MAX_DESCRIPTION} characters` },
  { id: 'skill-length', weight: 10, label: `Each SKILL.md is at most ${MAX_LINES} lines` },
  { id: 'compatibility', weight: 10, label: 'Compatibility is stated when the plugin targets specific languages (not "any")' },
  { id: 'docs', weight: 15, label: 'README.md and CHANGELOG.md are present' },
  { id: 'keywords', weight: 10, label: 'Every keyword is in taxonomy.json' },
];

export const SCORES_EXPLAINED = {
  bands: 'Meters: 90–100 good, 70–89 fair, below 70 poor. Each score is shown separately; there is no overall score.',
  security: [
    'Starts at 100.',
    `−${SECURITY_PENALTY.HIGH} per HIGH and −${SECURITY_PENALTY.MEDIUM} per MEDIUM finding from this repo's own hidden-content and patterns rules (rules/patterns.json), run on the plugin's files.`,
    'When SkillSpector (--no-llm, pinned) ran for the site build, security = min(rules score, 100 − SkillSpector risk). "SkillSpector: not run" means the scan was unavailable and only our rules count.',
    'Floored at 0.',
  ],
  quality: QUALITY_CRITERIA.map((c) => `${c.label} (${c.weight} points)`),
  evals: [
    'Measured, not computed: the pass rate from the latest benchmark in evals/results.json (each case with the skill and without it, 1 run per configuration).',
    'Delta is the pass rate with the skill minus the baseline pass rate, in percentage points.',
    'A run is only used for versions at or after the version it measured; if the plugin has changed since, the card says "measured on an earlier version".',
  ],
  adoption: ['Active consumers: team repos that commit the plugin in .claude/settings.json (insights data). Committed intent per repo, not installs.'],
  tracking: [
    'History is kept for major and minor versions only: a release is recorded when it is the plugin\'s first version, or its major.minor is higher than the last recorded one. Patch releases (x.y.z with z > 0) are not recorded; they still refresh the current scores (shown as "patch, not tracked").',
    '"▲/▼ n" on a card compares the current scores with the previous recorded (major/minor) version.',
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

/** Heuristic: does a skill description cover what / when / triggers / not-for, within the limit? */
export function describes(desc) {
  const d = typeof desc === 'string' ? desc : '';
  const parts = {
    what: d.trim().length >= 40,
    when: /\b(use (this|it)|when(ever)?)\b/i.test(d),
    triggers: /"[^"]{3,}"|\bfor example\b|\be\.g\./i.test(d),
    not_for: /\bnot for\b|\bdo not use\b|\bdon't use\b/i.test(d),
    length: d.length > 0 && d.length <= MAX_DESCRIPTION,
  };
  return { ok: Object.values(parts).every(Boolean), missing: Object.keys(parts).filter((k) => !parts[k]) };
}

/** Minimal frontmatter fields (description, compatibility) from a SKILL.md. */
export function frontmatterFields(md) {
  const out = {};
  const m = typeof md === 'string' ? md.match(/^---\r?\n([\s\S]*?)\r?\n---/) : null;
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2];
    if (/^[>|][-+]?$/.test(val)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      val = block.filter(Boolean).join(' ');
    } else if (/^(["']).*\1$/.test(val)) val = val.slice(1, -1);
    out[kv[1]] = val;
  }
  return out;
}

/**
 * Quality rubric. `plugin` is a loadPlugin() result; `files` the plugin's repo-relative files.
 * @returns {{score:number, max:number, criteria:{id,label,weight,passed,detail}[]}}
 */
export function qualityScore(plugin, taxonomy) {
  const skills = plugin.skills ?? [];
  const fm = skills.map((s) => ({ s, f: frontmatterFields(s.skillMd) }));
  const fail = (list) => (list.length ? list.join('; ') : 'all skills pass');
  const per = (pred) => skills.filter((s) => !pred(s)).map((s) => s.name);
  const results = {
    evals: (() => {
      const bad = per((s) => Array.isArray(s.evals?.evals) && s.evals.evals.length >= MIN_CASES);
      return { passed: skills.length > 0 && !bad.length, detail: skills.length ? fail(bad.map((n) => `${n}: fewer than ${MIN_CASES}`)) : 'no skills' };
    })(),
    triggers: (() => {
      const counts = skills.map((s) => {
        const t = Array.isArray(s.triggerEvals) ? s.triggerEvals : [];
        return { n: s.name, yes: t.filter((q) => q?.should_trigger === true).length, no: t.filter((q) => q?.should_trigger === false).length };
      });
      const bad = counts.filter((c) => c.yes < MIN_TRIGGER_EACH || c.no < MIN_TRIGGER_EACH);
      return { passed: skills.length > 0 && !bad.length, detail: counts.map((c) => `${c.n} ${c.yes}/${c.no}`).join('; ') || 'no skills' };
    })(),
    description: (() => {
      const bad = fm.map(({ s, f }) => ({ n: s.name, r: describes(f.description) })).filter((x) => !x.r.ok);
      return { passed: skills.length > 0 && !bad.length, detail: skills.length ? fail(bad.map((x) => `${x.n}: missing ${x.r.missing.join(', ')}`)) : 'no skills' };
    })(),
    'skill-length': (() => {
      const lens = skills.map((s) => ({ n: s.name, l: s.skillMd == null ? null : s.skillMd.replace(/\n$/, '').split('\n').length }));
      const bad = lens.filter((x) => x.l == null || x.l > MAX_LINES);
      return { passed: skills.length > 0 && !bad.length, detail: lens.map((x) => `${x.n} ${x.l ?? 'missing'} lines`).join('; ') || 'no skills' };
    })(),
    compatibility: (() => {
      const langs = plugin.catalogue?.languages ?? [];
      const specific = langs.length > 0 && !langs.includes('any');
      if (!specific) return { passed: true, detail: 'languages: any (not required)' };
      const has = fm.some(({ f }) => typeof f.compatibility === 'string' && f.compatibility.trim());
      return { passed: has, detail: has ? 'stated in SKILL.md' : `not stated (languages: ${langs.join(', ')})` };
    })(),
    docs: (() => {
      const files = new Set(plugin.files ?? []);
      const missing = ['README.md', 'CHANGELOG.md'].filter((f) => !files.has(`${plugin.path}/${f}`));
      return { passed: !missing.length, detail: missing.length ? `missing ${missing.join(', ')}` : 'both present' };
    })(),
    keywords: (() => {
      const allowed = new Set(taxonomy?.tags ?? []);
      const kw = plugin.manifest?.keywords ?? [];
      const off = kw.filter((k) => !allowed.has(k));
      return { passed: kw.length > 0 && !off.length, detail: !kw.length ? 'no keywords' : off.length ? `not in taxonomy: ${off.join(', ')}` : `${kw.length} keywords, all on-taxonomy` };
    })(),
  };
  const criteria = QUALITY_CRITERIA.map((c) => ({ ...c, ...results[c.id] }));
  const max = QUALITY_CRITERIA.reduce((n, c) => n + c.weight, 0);
  return { score: criteria.reduce((n, c) => n + (c.passed ? c.weight : 0), 0), max, criteria };
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
  const pass = pct(r.with_skill);
  const base = pct(r.baseline);
  return {
    pass_rate: pass,
    baseline_pass_rate: base,
    delta: pass != null && base != null ? Math.round((pass - base) * 10) / 10 : null,
    passed: r.with_skill?.passed ?? null,
    total: r.with_skill?.total ?? null,
    baseline_passed: r.baseline?.passed ?? null,
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
export function scorePlugin({ root, repo, plugin, evalsResults = null, skillspector = null, consumers = null }) {
  const risk = skillspector && typeof skillspector[plugin.dir] === 'number' ? skillspector[plugin.dir] : null;
  const out = {
    security: securityScore(securityFindings(root, repo, plugin), risk),
    quality: qualityScore(plugin, repo.taxonomy),
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
    quality_criteria: scores.quality.criteria.map(({ id, weight, passed, detail }) => ({ id, weight, passed, detail })),
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
    if (!cur || compare(record.version, cur.version) > 0) {
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

/** Change of current scores vs a previous history record: {security, quality, evals} in points, null if unknown. */
export function scoreChange(current, previous) {
  if (!previous) return null;
  const d = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.round((a - b) * 10) / 10 : null);
  return {
    vs_version: previous.version,
    security: d(current.security?.score, previous.security),
    quality: d(current.quality?.score, previous.quality),
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
function scoreTag(root, tag, { recordedAt, skillspector, skillspectorNote, evalsResults }) {
  const { plugin, version } = splitTag(tag);
  const dir = extractTag(root, tag);
  try {
    const repo = loadRepo(dir);
    const p = repo.plugins.find((x) => x.dir === plugin);
    if (!p) return null;
    const scores = scorePlugin({ root: dir, repo, plugin: p, evalsResults, skillspector });
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
    else if (['--base', '--root', '--data', '--skillspector', '--now', '--collect-skillspector'].includes(a)) opt[a.slice(2)] = argv[++i];
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
    const note = opt.mode === 'backfill' ? 'SkillSpector not run (backfill)' : skillspector ? null : 'SkillSpector not run (install or scan failed)';
    const now = opt.now ?? new Date().toISOString();
    const candidates = wanted.map(splitTag).sort(byPluginVersion)
      .map(({ plugin, version }) => scoreTag(opt.root, `${plugin}--v${version}`, {
        recordedAt: opt.mode === 'record' ? now : null, skillspector, skillspectorNote: note, evalsResults,
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

  log('usage: scores.mjs --compare --base <dir> [--root <dir>] | --record --data <dir> [--skillspector <json>] | --backfill --data <dir> | --collect-skillspector <dir>');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
