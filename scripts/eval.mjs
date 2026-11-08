#!/usr/bin/env node
// npm run eval <plugin> [-- --runs N] [--case GLOB] [--tag TAG] [--ablation none] [--max-cost-usd N]
//                       [--model M] [--judge-model M] [--keep-temp] [--dry-run]
// Runs plugins/<plugin>/evals/ (native `claude plugin eval` cases) with and without the plugin,
// locally and by hand: it uses your Claude plan, so it never runs in CI. Appends the result to
// evals/results.json, except for partial runs and runs narrowed with --case / --tag.
// Report and JSON go to eval-build/<plugin>/ (gitignored).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Pinned so a model rollout is not mistaken for a plugin change. */
export const MODEL = 'claude-sonnet-5';
export const JUDGE_MODEL = 'claude-sonnet-5';
export const MAX_COST_USD = 10;
export const BUILD_DIR = 'eval-build';
/** Tools the behaviour cases need (edit files, run gofmt / tsc / tests); Bash runs in the eval sandbox. */
export const ALLOW_TOOLS = ['Bash', 'Edit', 'Write'];

export function parseArgs(argv) {
  const opt = { plugin: null, runs: null, caseGlob: null, tag: null, ablation: 'with-without', maxCost: MAX_COST_USD, model: MODEL, judgeModel: JUDGE_MODEL, keepTemp: false, dryRun: false };
  const val = (i) => { if (argv[i] == null) throw new Error(`${argv[i - 1]} needs a value`); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') opt.runs = val(++i);
    else if (a === '--case') opt.caseGlob = val(++i);
    else if (a === '--tag') opt.tag = val(++i);
    else if (a === '--ablation') opt.ablation = val(++i);
    else if (a === '--max-cost-usd') opt.maxCost = val(++i);
    else if (a === '--model') opt.model = val(++i);
    else if (a === '--judge-model') opt.judgeModel = val(++i);
    else if (a === '--keep-temp') opt.keepTemp = true;
    else if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--record') { /* recording is the default; accepted for older instructions */ }
    else if (!a.startsWith('-') && !opt.plugin) opt.plugin = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opt.plugin) throw new Error('usage: npm run eval <plugin> [-- --runs N] [--case GLOB] [--tag TAG] [--ablation none] [--max-cost-usd N] [--model M] [--judge-model M] [--keep-temp] [--dry-run]');
  if (!(Number(opt.maxCost) > 0)) throw new Error('--max-cost-usd needs a positive number');
  if (opt.runs != null && !(Number.isInteger(Number(opt.runs)) && Number(opt.runs) > 0)) throw new Error('--runs needs a positive integer');
  if (!['with-without', 'none'].includes(opt.ablation)) throw new Error('--ablation is with-without or none');
  return opt;
}

/** The `claude` argv (target first: --allow-tools takes a list). */
export function cliArgs(opt, { jsonFile, outDir }) {
  const a = ['plugin', 'eval', `plugins/${opt.plugin}`,
    '--model', opt.model, '--judge-model', opt.judgeModel, '--ablation', opt.ablation,
    '--max-cost-usd', String(opt.maxCost), '--scaffold', '--trust-plugin', '--no-publish', '--output-dir', outDir];
  if (opt.runs != null) a.push('--runs', String(opt.runs));
  if (opt.caseGlob != null) a.push('--case', opt.caseGlob);
  if (opt.tag != null) a.push('--tag', opt.tag);
  if (opt.keepTemp) a.push('--keep-temp');
  a.push('--allow-tools', ...ALLOW_TOOLS, '--json', jsonFile);
  return a;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The fields we keep from a `claude plugin eval` result document (schemaVersion 1). */
export function summarise(json) {
  const ag = json?.aggregates ?? {};
  return {
    overall_score: num(ag.overallScore),
    mean_delta: num(ag.meanDelta),
    cases_passed: num(ag.casesPassed),
    cases_total: num(ag.casesTotal),
    cost_usd: num(json?.costUsd),
    claude_version: json?.claudeVersion ?? null,
    partial: json?.partial === true ? (json.partialReason ?? 'partial') : null,
    cases: (json?.cases ?? []).map((c) => ({ name: c.name, score: num(c.aggregates?.score), delta: num(c.aggregates?.delta) })),
  };
}

const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

/** The run object appended to evals/results.json (read by scripts/scores.mjs evalsFor). */
export function resultRecord({ plugin, version, summary, opt, now = new Date() }) {
  return {
    plugin,
    version,
    measured_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    method: 'claude plugin eval',
    overall_score: r3(summary.overall_score),
    mean_delta: r3(summary.mean_delta),
    cases_passed: summary.cases_passed,
    cases_total: summary.cases_total,
    cost_usd: summary.cost_usd == null ? null : Math.round(summary.cost_usd * 100) / 100,
    claude_version: summary.claude_version,
    model: opt.model,
    judge_model: opt.judgeModel,
    ablation: opt.ablation,
  };
}

/** Append a run to results.json ({runs: [...]} or a bare array), never editing old runs. */
export function appendResult(file, record) {
  let data = { runs: [] };
  if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(data)) data.push(record);
  else (data.runs ??= []).push(record);
  // Keep the file's style ({ "passed": N, "total": M } on one line) so old runs stay byte-identical.
  const text = JSON.stringify(data, null, 2)
    .replace(/\{\n\s*"passed": (\d+),\n\s*"total": (\d+)\n\s*\}/g, '{ "passed": $1, "total": $2 }');
  writeFileSync(file, text + '\n');
}

const fmt = (v, sign = false) => (v == null ? '-' : `${sign && v >= 0 ? '+' : ''}${v.toFixed(2)}`);

export function formatTable(s) {
  const rows = [['case', 'score', 'delta'], ...s.cases.map((c) => [String(c.name), fmt(c.score), fmt(c.delta, true)])];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((v, i) => v.padEnd(w[i])).join('  '));
  lines.splice(1, 0, w.map((n) => '-'.repeat(n)).join('  '));
  lines.push('', `overall ${fmt(s.overall_score)}   mean delta ${fmt(s.mean_delta, true)}   cases passed ${s.cases_passed ?? '-'}/${s.cases_total ?? '-'}` +
    `   cost ${s.cost_usd == null ? '-' : `$${s.cost_usd.toFixed(2)}`}${s.partial ? `   PARTIAL: ${s.partial}` : ''}`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), { root = ROOT, log = console.log, run = spawnSync, now = new Date() } = {}) {
  const opt = parseArgs(argv);
  const manifest = join(root, 'plugins', opt.plugin, '.claude-plugin/plugin.json');
  if (!existsSync(manifest)) throw new Error(`no plugin at plugins/${opt.plugin}`);
  const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
  const outDir = join(root, BUILD_DIR, opt.plugin);
  const jsonFile = join(outDir, 'result.json');
  const args = cliArgs(opt, { jsonFile, outDir: join(outDir, 'report') });
  log(`${opt.plugin} ${version}: claude ${args.join(' ')}`);
  if (opt.dryRun) return 0;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = run('claude', args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw new Error(`could not run claude: ${r.error.message}`);
  if (!existsSync(jsonFile)) throw new Error(`claude plugin eval exited ${r.status} without writing ${relative(root, jsonFile)}`);
  const summary = summarise(JSON.parse(readFileSync(jsonFile, 'utf8')));
  log(formatTable(summary));
  log(`report: ${relative(root, join(outDir, 'report'))}/`);
  if (summary.partial) log(`not recorded: partial run (${summary.partial})`);
  else if (opt.caseGlob != null || opt.tag != null) log('not recorded: --case / --tag ran part of the suite');
  else if (summary.overall_score == null) log('not recorded: no overallScore in the result');
  else {
    const rec = resultRecord({ plugin: opt.plugin, version, summary, opt, now });
    appendResult(join(root, 'evals/results.json'), rec);
    log(`recorded in evals/results.json: ${JSON.stringify(rec)}`);
  }
  return r.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (e) { console.error(`eval: ${e.message}`); process.exitCode = 2; }
}
