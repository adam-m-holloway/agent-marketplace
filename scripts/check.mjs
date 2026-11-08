#!/usr/bin/env node
// npm run check — every `plugins` and `security` rule, all findings reported together.
//   node scripts/check.mjs [--root <dir>] [--base <dir>] [--pr <pr.json>] [--only plugins|security] [--full] [--json]
// Local and CI are identical; CI passes --base (base-branch tree) and --pr (PR metadata).
// Exit 1 on any ERROR or HIGH finding. MEDIUM is reported only.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadRepo, walk } from './lib/plugins.mjs';

const RULES_DIR = new URL('./lib/rules/', import.meta.url);
export const SEVERITIES = ['ERROR', 'HIGH', 'MEDIUM'];

/** Every rule module in scripts/lib/rules (files starting with "_" are helpers). */
export async function loadRules() {
  const files = readdirSync(RULES_DIR).filter((n) => n.endsWith('.mjs') && !n.startsWith('_')).sort();
  const rules = [];
  for (const n of files) rules.push((await import(new URL(n, RULES_DIR))).default);
  return rules;
}

/** Plugin dirs whose files differ between two trees (added, removed or modified). */
export function changedPluginDirs(baseRoot, root) {
  const dirs = (r) => new Set(walk(join(r, 'plugins')).map((f) => f.split('/')[0]));
  const all = [...new Set([...dirs(baseRoot), ...dirs(root)])].sort();
  return all.filter((d) => {
    const a = walk(join(baseRoot, 'plugins', d));
    const b = walk(join(root, 'plugins', d));
    if (a.join('\n') !== b.join('\n')) return true;
    return a.some((f) => !readFileSync(join(baseRoot, 'plugins', d, f)).equals(readFileSync(join(root, 'plugins', d, f))));
  });
}

export function buildContext({ root, base = null, pr = null }) {
  const repo = loadRepo(root);
  const baseCtx = base ? { root: base, repo: loadRepo(base) } : null;
  return { root, repo, base: baseCtx, pr, changedPlugins: baseCtx ? changedPluginDirs(base, root) : [] };
}

/** @returns {Promise<{findings: object[], notices: string[], ran: string[]}>} */
export async function runChecks({ root, base = null, pr = null, only = null, rules = null }) {
  const ctx = buildContext({ root, base, pr });
  const notices = [];
  const findings = [];
  const ran = [];
  for (const rule of rules ?? (await loadRules())) {
    if (only && rule.group !== only) continue;
    if (rule.ciOnly && !pr) continue;
    if (rule.needsBase && !base) {
      notices.push(`${rule.id} skipped: no --base tree to compare against`);
      continue;
    }
    ran.push(rule.id);
    try {
      findings.push(...(await rule.run(ctx)));
    } catch (e) {
      findings.push({ rule: rule.id, severity: 'ERROR', file: '-', message: `rule crashed: ${e.stack ?? e}` });
    }
  }
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule));
  return { findings, notices, ran };
}

export const failing = (findings) => findings.filter((x) => x.severity === 'ERROR' || x.severity === 'HIGH');

export function format({ findings, ran }) {
  const lines = [];
  for (const sev of SEVERITIES) {
    for (const x of findings.filter((y) => y.severity === sev)) {
      lines.push(`${x.severity} ${x.rule} ${x.file}${x.line ? `:${x.line}` : ''} ${x.message}`);
    }
  }
  const n = (s) => findings.filter((x) => x.severity === s).length;
  const verdict = failing(findings).length ? 'FAILED' : 'passed';
  lines.push(`check ${verdict}: ${n('ERROR')} error, ${n('HIGH')} high, ${n('MEDIUM')} medium (${ran.length} checks run)`);
  return lines.join('\n');
}

const onPath = (tool) => spawnSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }).status === 0;

/** --full: npm test + external tools that happen to be installed. */
function runFull(root, repo, notices, only) {
  const findings = [];
  const ran = [];
  const run = (id, cmd, args, opts = {}) => {
    ran.push(id);
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
    if (r.status !== 0) {
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
      findings.push({ rule: id, severity: 'ERROR', file: root, message: `${cmd} ${args.join(' ')} failed (exit ${r.status})${out ? `\n${out}` : ''}` });
    }
  };
  const tool = (name, fn) => (onPath(name) ? fn() : notices.push(`${name} not on PATH — skipped`));
  if (!only || only === 'plugins') {
    run('npm-test', 'npm', ['test'], { stdio: ['ignore', 'pipe', 'pipe'] });
    tool('claude', () => {
      run('claude-validate', 'claude', ['plugin', 'validate', root, '--strict']);
      for (const p of repo.plugins) run('claude-validate', 'claude', ['plugin', 'validate', join(root, p.path), '--strict']);
    });
  }
  if (!only || only === 'security') {
    tool('gitleaks', () => run('gitleaks', 'gitleaks', ['dir', join(root, 'plugins'), '--no-banner']));
    tool('skillspector', () => { for (const p of repo.plugins) run('skillspector', 'skillspector', ['scan', join(root, p.path), '--no-llm']); });
  }
  if (!only) {
    tool('actionlint', () => run('actionlint', 'actionlint', []));
    tool('zizmor', () => run('zizmor', 'zizmor', [join(root, '.github', 'workflows')]));
  }
  return { findings, ran };
}

function parseArgs(argv) {
  const o = { root: process.cwd(), base: null, pr: null, only: null, full: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--root') o.root = resolve(val());
    else if (a === '--base') o.base = resolve(val());
    else if (a === '--pr') o.pr = JSON.parse(readFileSync(val(), 'utf8'));
    else if (a === '--only') {
      o.only = val();
      if (!['plugins', 'security'].includes(o.only)) throw new Error('--only must be plugins or security');
    } else if (a === '--full') o.full = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') {
      console.log('usage: node scripts/check.mjs [--root <dir>] [--base <dir>] [--pr <pr.json>] [--only plugins|security] [--full] [--json]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`check: ${e.message}`);
    process.exit(2);
  }
  const result = await runChecks(o);
  if (o.full) {
    const extra = runFull(o.root, loadRepo(o.root), result.notices, o.only);
    result.findings.push(...extra.findings);
    result.ran.push(...extra.ran);
  }
  for (const n of result.notices) console.error(`notice: ${n}`);
  if (o.json) console.log(JSON.stringify(result.findings, null, 2));
  else console.log(format(result));
  process.exit(failing(result.findings).length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
