#!/usr/bin/env node
// npm run eval <plugin> [--max-cost-usd N] [--dry-run] [--record]
// Converts each skill's skill-creator evals.json into a `claude plugin eval` suite under
// eval-build/<plugin>/ (not dot-prefixed: the CLI rejects --eval-dir segments starting with "."), runs it locally (never in CI: it uses your Claude plan), prints a
// per-case table and, with --record, appends the run to evals/results.json. The eval sandbox has
// no network, so Node cases' dependencies are installed beforehand into eval-build/.deps/<hash>/
// and copied into each run's workspace by its scaffold script.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Frontmatter keys `claude plugin eval` accepts in prompt.md. */
export const PROMPT_KEYS = ['max_turns', 'allowed_tools', 'model', 'timeout_seconds', 'tags'];
/** Defaults for every case (only whitelisted keys). */
export const DEFAULT_FRONTMATTER = { max_turns: 30, timeout_seconds: 600 };
/** Where a case's fixture files go, relative to the case directory. */
export const WORKSPACE_DIR = 'workspace';
/** Build folder (gitignored): eval-build/<plugin>/{suite/, result.json, results/}. */
export const BUILD_DIR = 'eval-build';

/** Copies the case's workspace/ fixture into the current directory. */
export const SCAFFOLD_SH = '#!/bin/sh\nset -e\ncp -R "$(dirname "$0")/' + WORKSPACE_DIR + '/." .\n';

/** Dependency cache (gitignored, kept between runs): eval-build/.deps/<hash>/node_modules. */
export const DEPS_DIR = '.deps';

/** package.json given to a TypeScript case whose fixture has none (build dir only, never plugins/). */
export const DEFAULT_PACKAGE_JSON = {
  name: 'eval-workspace',
  version: '0.0.0',
  private: true,
  type: 'module',
  scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' },
  devDependencies: { typescript: '7.0.2', vitest: '5.1.0' },
};

/** tsconfig.json given alongside it, so `tsc --noEmit` has a project to check. */
export const DEFAULT_TSCONFIG = {
  compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true },
  include: ['src'],
};

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The install manifest for a fixture package.json: only its dependency fields (sorted), so
 * fixtures that declare the same dependencies share one cache entry.
 */
export function depsManifest(pkg) {
  const m = { name: 'eval-deps', private: true };
  for (const k of DEP_FIELDS) if (pkg?.[k] && Object.keys(pkg[k]).length) m[k] = sortObj(pkg[k]);
  return m;
}

/** Cache key for a dependency manifest: the first 16 hex chars of its sha256. */
export function depsHash(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
}

/** A case runs Node tooling when its skill ships package.json fixtures and the case talks about TS/npm. */
export function isNodeCase(c, skillHasPackageJson) {
  if (!skillHasPackageJson) return false;
  const text = [c.prompt, c.expected_output, ...(c.expectations ?? [])].join('\n');
  return /\b(typescript|tsc|vitest|npm|npx)\b/i.test(text);
}

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * The scaffold script. It runs as you, outside the agent's sandbox, in the empty run workspace:
 * it copies the fixture, then (Node cases) copies the pre-installed node_modules from the
 * dependency cache, and (Go cases) points the Go toolchain at writable dirs in the workspace and
 * forbids toolchain/module downloads, via `go env -w` (stored in the run's temporary HOME; skipped
 * if HOME is still `realHome`, so your own Go config is never changed).
 */
export function scaffoldScript({ nodeModules = null, go = false, realHome = homedir() } = {}) {
  let sh = SCAFFOLD_SH;
  if (nodeModules) sh += `if [ ! -e node_modules ]; then cp -R ${shq(nodeModules)} ./node_modules; fi\n`;
  if (go) {
    sh += `if command -v go >/dev/null 2>&1 && [ "$HOME" != ${shq(realHome)} ]; then\n` +
      '  go env -w GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOCACHE="$PWD/.cache/go-build" GOPATH="$PWD/.cache/go"\n' +
      'fi\n';
  }
  return sh;
}

const yamlScalar = (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(String(v)));

/** Render a YAML frontmatter block from an object, keeping only `allowed` keys, in a stable order. */
export function frontmatter(data, allowed = null) {
  const keys = Object.keys(data).filter((k) => !allowed || allowed.includes(k)).sort();
  const lines = [];
  for (const k of keys) {
    const v = data[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlScalar(item)}`);
    } else lines.push(`${k}: ${yamlScalar(v)}`);
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * Concrete repo-relative file paths an expectation says should exist (contain a slash, end in an
 * extension, no regex/glob characters). Negative expectations ("No …", "not created") give none.
 */
export function concretePaths(expectation) {
  if (/^\s*no\b/i.test(expectation) || /\b(not|never|no longer)\b[^.]*\b(created|exist|exists|present)\b/i.test(expectation)) return [];
  const out = new Set();
  for (const m of expectation.matchAll(/(?<![\w./-])((?:[\w-]+\/)+[\w.-]+\.[A-Za-z]{1,5})(?![\w/[\]*+?(){}|\\^$-])/g)) {
    const p = m[1].replace(/\.+$/, '');
    if (!p.startsWith('.') && !p.includes('..')) out.add(p);
  }
  return [...out];
}

/**
 * Map a case's `files` entry (relative to the skill dir, e.g. evals/files/<fixture>/src/a.ts) to
 * its path inside the workspace (src/a.ts).
 */
export function workspacePath(file) {
  const f = file.split(/[\\/]/).join('/');
  const m = f.match(/^evals\/files\/[^/]+\/(.+)$/);
  return m ? m[1] : posix.basename(f);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** List a plugin's skills that have evals/evals.json, sorted. */
export function skillsWithEvals(pluginDir) {
  const dir = join(pluginDir, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'evals/evals.json')))
    .map((d) => d.name)
    .sort();
}

/**
 * Deterministically convert every skill's evals.json under `pluginDir` into a
 * `claude plugin eval` suite in `outDir` (wiped first). Returns the plan:
 * [{ case, skill, id, graders: [names], files: [workspace paths], deps: {hash, manifest}|null, go }].
 * Node cases' scaffolds copy `<depsRoot>/<hash>/node_modules` (filled by `prepareDeps`).
 */
export function buildEvalDir(pluginDir, outDir, { depsRoot = resolve(outDir, '../..', DEPS_DIR) } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const plan = [];
  for (const skill of skillsWithEvals(pluginDir)) {
    const skillDir = join(pluginDir, 'skills', skill);
    const spec = JSON.parse(readFileSync(join(skillDir, 'evals/evals.json'), 'utf8'));
    const cases = [...(spec.evals ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
    const skillHasPackageJson = cases.some((c) => (c.files ?? []).some((f) => workspacePath(f) === 'package.json'));
    for (const c of cases) {
      const name = `${skill}-${slug(c.id)}`;
      const caseDir = join(outDir, name);
      mkdirSync(join(caseDir, 'graders'), { recursive: true });
      const fm = { ...DEFAULT_FRONTMATTER, tags: [skill] };
      writeFileSync(join(caseDir, 'prompt.md'), `${frontmatter(fm, PROMPT_KEYS)}\n${String(c.prompt).trim()}\n`);

      const graders = [];
      const expectations = c.expectations ?? [];
      expectations.forEach((e, i) => {
        const g = `${String(i + 1).padStart(2, '0')}-llm`;
        writeFileSync(join(caseDir, 'graders', `${g}.md`),
          `${frontmatter({ type: 'llm', criteria: `PASS if ${String(e).trim()}` })}\nPASS if ${String(e).trim()}\nOtherwise FAIL.\n`);
        graders.push(g);
      });
      const paths = [...new Set(expectations.flatMap(concretePaths))].sort();
      paths.forEach((p) => {
        const g = `file-${slug(p)}`;
        writeFileSync(join(caseDir, 'graders', `${g}.md`), `${frontmatter({ type: 'file_exists', path: p })}`);
        graders.push(g);
      });

      const files = [];
      for (const f of [...(c.files ?? [])].sort()) {
        const to = workspacePath(f);
        mkdirSync(dirname(join(caseDir, WORKSPACE_DIR, to)), { recursive: true });
        cpSync(join(skillDir, f), join(caseDir, WORKSPACE_DIR, to));
        files.push(to);
      }
      let deps = null;
      if (isNodeCase(c, skillHasPackageJson)) {
        const ws = join(caseDir, WORKSPACE_DIR);
        mkdirSync(ws, { recursive: true });
        // A TS case without a project gets a minimal one (build dir only).
        for (const [f, data] of [['package.json', DEFAULT_PACKAGE_JSON], ['tsconfig.json', DEFAULT_TSCONFIG]]) {
          if (files.includes(f)) continue;
          writeFileSync(join(ws, f), JSON.stringify(data, null, 2) + '\n');
          files.push(f);
        }
        files.sort();
        const manifest = depsManifest(JSON.parse(readFileSync(join(ws, 'package.json'), 'utf8')));
        deps = { hash: depsHash(manifest), manifest };
      }
      const go = files.includes('go.mod');
      if (files.length) {
        // The CLI has no fixture folder of its own: a scaffold script copies workspace/ into the
        // run's working directory (needs --scaffold at run time).
        const nodeModules = deps ? join(depsRoot, deps.hash, 'node_modules') : null;
        writeFileSync(join(caseDir, 'scaffold.sh'), scaffoldScript({ nodeModules, go }), { mode: 0o755 });
        writeFileSync(join(caseDir, 'case.yaml'),
          `schema_version: "1.1"\nname: ${JSON.stringify(name)}\ncontext:\n  scaffold_script: scaffold.sh\n`);
      }
      plan.push({ case: name, skill, id: c.id, graders, files, deps, go });
    }
  }
  return plan;
}

/** Distinct dependency sets in a plan, by hash. */
export function depsToInstall(plan) {
  const m = new Map();
  for (const p of plan) if (p.deps && !m.has(p.deps.hash)) m.set(p.deps.hash, p.deps.manifest);
  return [...m].map(([hash, manifest]) => ({ hash, manifest }));
}

/** npm argv for filling a cache entry (no lifecycle scripts, no audit/fund noise). */
export const NPM_INSTALL_ARGS = ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'];

/**
 * Install each dependency set once, with network, outside the eval sandbox, into
 * `<depsRoot>/<hash>/node_modules`. An entry is reused when its `.ready` marker exists.
 * Returns [{hash, cached}].
 */
export function prepareDeps(depsRoot, sets, { run = spawnSync, log = console.log } = {}) {
  const out = [];
  for (const { hash, manifest } of sets) {
    const dir = join(depsRoot, hash);
    if (existsSync(join(dir, '.ready')) && existsSync(join(dir, 'node_modules'))) { out.push({ hash, cached: true }); continue; }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    log(`installing eval dependencies ${hash} (npm ${NPM_INSTALL_ARGS.join(' ')})`);
    const r = run('npm', NPM_INSTALL_ARGS, { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.error || r.status !== 0) throw new Error(`npm install failed for eval dependencies ${hash} (${r.error?.message ?? `exit ${r.status}`})`);
    writeFileSync(join(dir, '.ready'), '');
    out.push({ hash, cached: false });
  }
  return out;
}

// ---------- results ----------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const EXPECTATION_GRADER = /^\d+-llm$/;

/** true/false/null from a grader or run result, tolerant of field names (the schema is additive). */
export function passOf(x) {
  if (x == null) return null;
  if (typeof x === 'boolean') return x;
  for (const k of ['passed', 'pass', 'success', 'ok']) if (typeof x[k] === 'boolean') return x[k];
  if (typeof x.verdict === 'string') return /^pass/i.test(x.verdict);
  if (typeof x.status === 'string') return /^pass/i.test(x.status);
  if (typeof x.score === 'number') return x.score >= 1;
  if (Array.isArray(x.graders)) {
    const scored = x.graders.filter((g) => g?.scored !== false);
    return scored.length ? scored.every((g) => passOf(g) === true) : null;
  }
  return null;
}

const graderName = (g) => String(g?.name ?? g?.grader ?? g?.id ?? '').replace(/\.md$/, '');

/** One arm's runs → { passed: case verdict (majority of runs), exp: {passed,total} over expectation graders }. */
function armSummary(runs) {
  if (!Array.isArray(runs) || !runs.length) return null;
  const verdicts = runs.map(passOf).filter((v) => v != null);
  let passed = 0;
  let total = 0;
  for (const r of runs) {
    for (const g of r?.graders ?? []) {
      if (!EXPECTATION_GRADER.test(graderName(g)) || g?.scored === false) continue;
      total++;
      if (passOf(g) === true) passed++;
    }
  }
  return { passed: verdicts.filter(Boolean).length * 2 > verdicts.length, exp: { passed, total } };
}

/**
 * Normalise `claude plugin eval --json` (v1: cases[].arms.with[] / .without[], each run with
 * graders[]) into { cases: [{case, passed, baseline_passed|null, with, baseline}],
 * with: {passed,total}, baseline: {passed,total}|null, cost_usd|null, partial|null,
 * errors: ["<case> <arm>: <error>"] } — errors are runs that didn't finish (e.g. "timed out
 * after 600s"); their graders still ran on whatever was left, so such a run is not recordable.
 * Totals count expectation graders (NN-llm): the same unit as the skill-creator benchmarks.
 */
export function parseEvalJson(json) {
  const raw = Array.isArray(json?.cases) ? json.cases : [];
  const cases = raw.map((c) => {
    const w = armSummary(c?.arms?.with ?? c?.runs);
    const b = armSummary(c?.arms?.without);
    return {
      case: c.name ?? c.case ?? c.id,
      passed: w?.passed ?? false,
      baseline_passed: b ? b.passed : null,
      with: w?.exp ?? { passed: 0, total: 0 },
      baseline: b?.exp ?? null,
    };
  });
  const sum = (k) => cases.reduce((a, c) => ({ passed: a.passed + (c[k]?.passed ?? 0), total: a.total + (c[k]?.total ?? 0) }), { passed: 0, total: 0 });
  const findCost = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 2) return null;
    for (const k of ['totalCostUsd', 'costUsd', 'cost_usd', 'total_cost_usd']) if (num(o[k]) != null) return o[k];
    for (const k of ['aggregates', 'summary', 'cost', 'totals']) { const v = findCost(o[k], depth + 1); if (v != null) return v; }
    return null;
  };
  return {
    cases,
    with: sum('with'),
    baseline: cases.some((c) => c.baseline) ? sum('baseline') : null,
    cost_usd: findCost(json),
    partial: json?.partialReason ?? (json?.partial === true ? 'partial' : null),
    errors: raw.flatMap((c) => Object.entries(c?.arms ?? {}).flatMap(([arm, runs]) =>
      (Array.isArray(runs) ? runs : []).filter((r) => r?.error || r?.aborted).map((r) => `${c.name ?? c.case ?? c.id} ${arm}: ${r.error ?? 'aborted'}`))),
  };
}

/** The run object appended to evals/results.json (shape read by scripts/scores.mjs evalsFor). */
export function resultRecord({ plugin, version, summary, now = new Date() }) {
  const r = {
    plugin,
    version,
    measured_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    with_skill: summary.with,
    baseline: summary.baseline,
    method: 'claude plugin eval',
  };
  if (summary.cost_usd != null) r.cost_usd = Math.round(summary.cost_usd * 100) / 100;
  return r;
}

/** Append a run to results.json (object with `runs`, or a bare array), never editing old runs. */
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

/** Bash commands that run the toolchains the cases depend on. */
export const TOOLCHAIN_RE = /\b(tsc|vitest|npm (test|run)|gofmt|go (vet|test|build))\b/;

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n') : '');

/**
 * From a run's trace.jsonl (stream-json: assistant tool_use blocks, user tool_result blocks), the
 * Bash calls whose command matches `re`, with the first lines of their output — evidence that a
 * toolchain really ran inside the sandbox. Returns [{command, output, is_error}].
 */
export function toolchainCalls(traceText, re = TOOLCHAIN_RE, maxLines = 4) {
  const calls = new Map();
  for (const line of String(traceText).split('\n')) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    for (const b of Array.isArray(m?.message?.content) ? m.message.content : []) {
      if (b?.type === 'tool_use' && b.name === 'Bash' && re.test(String(b.input?.command ?? ''))) {
        calls.set(b.id, { command: String(b.input.command), output: null, is_error: null });
      } else if (b?.type === 'tool_result' && calls.has(b.tool_use_id)) {
        const c = calls.get(b.tool_use_id);
        c.output = textOf(b.content).split('\n').filter((l) => l.trim()).slice(0, maxLines).join('\n');
        c.is_error = b.is_error === true;
      }
    }
  }
  return [...calls.values()];
}

export function formatTable(summary) {
  const cell = (ok, e) => `${ok ? 'PASS' : 'FAIL'} ${e.passed}/${e.total}`;
  const rows = [['case', 'with plugin', 'baseline']];
  for (const c of summary.cases) rows.push([String(c.case), cell(c.passed, c.with), c.baseline ? cell(c.baseline_passed, c.baseline) : '-']);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((v, i) => v.padEnd(w[i])).join('  '));
  lines.splice(1, 0, w.map((n) => '-'.repeat(n)).join('  '));
  const b = summary.baseline;
  lines.push('', `expectations with plugin: ${summary.with.passed}/${summary.with.total}` +
    (b ? `   baseline: ${b.passed}/${b.total}   delta: ${summary.with.passed - b.passed >= 0 ? '+' : ''}${summary.with.passed - b.passed}` : '   baseline: not reported') +
    (summary.cost_usd != null ? `   cost: $${summary.cost_usd}` : '') +
    (summary.partial ? `   PARTIAL: ${summary.partial}` : '') +
    (summary.errors?.length ? `\nruns that did not finish (${summary.errors.length}): ${summary.errors.join('; ')}` : ''));
  return lines.join('\n');
}

// ---------- CLI ----------

export function parseArgs(argv) {
  const opt = { plugin: null, maxCost: null, dryRun: false, record: false, caseGlob: null, keepTemp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--case') opt.caseGlob = argv[++i];
    else if (a === '--keep-temp') opt.keepTemp = true;
    else if (a === '--record') opt.record = true;
    else if (a === '--max-cost-usd') opt.maxCost = argv[++i];
    else if (a.startsWith('--max-cost-usd=')) opt.maxCost = a.slice(15);
    else if (!a.startsWith('-') && !opt.plugin) opt.plugin = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opt.plugin) throw new Error('usage: npm run eval <plugin> [-- --max-cost-usd N] [--dry-run] [--record] [--case GLOB] [--keep-temp]');
  if (opt.maxCost != null && !(Number(opt.maxCost) > 0)) throw new Error('--max-cost-usd needs a positive number');
  return opt;
}

/** Tools the cases need (edit files, run tsc / tests). */
export const ALLOW_TOOLS = ['Bash', 'Edit', 'Write'];

/**
 * The `claude` argv for a plugin run (target first, as the CLI requires): one run per arm, with
 * and without the plugin, scaffolds on, JSON written to a file, no report publishing.
 */
export function cliArgs({ plugin, evalDir, jsonFile, maxCost = null, caseGlob = null, keepTemp = false }) {
  const a = ['plugin', 'eval', `plugins/${plugin}`, '--allow-tools', ...ALLOW_TOOLS,
    '--eval-dir', evalDir, '--json', jsonFile, '--no-publish', '--runs', '1',
    '--ablation', 'with-without', '--scaffold', '--trust-plugin'];
  if (caseGlob != null) a.push('--case', caseGlob);
  if (keepTemp) a.push('--keep-temp');
  if (maxCost != null) a.push('--max-cost-usd', String(maxCost));
  return a;
}

export function main(argv = process.argv.slice(2), { root = ROOT, log = console.log, run = spawnSync } = {}) {
  const opt = parseArgs(argv);
  const pluginDir = join(root, 'plugins', opt.plugin);
  if (!existsSync(join(pluginDir, '.claude-plugin/plugin.json'))) throw new Error(`no plugin at plugins/${opt.plugin}`);
  const version = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin/plugin.json'), 'utf8')).version;
  const outDir = join(root, BUILD_DIR, opt.plugin);
  const suiteDir = join(outDir, 'suite');
  rmSync(outDir, { recursive: true, force: true });
  const depsRoot = join(root, BUILD_DIR, DEPS_DIR);
  const plan = buildEvalDir(pluginDir, suiteDir, { depsRoot });
  const sets = depsToInstall(plan);
  const jsonFile = join(outDir, 'result.json');
  const stageDir = join(pluginDir, BUILD_DIR);
  const args = cliArgs({ plugin: opt.plugin, evalDir: BUILD_DIR, jsonFile, maxCost: opt.maxCost, caseGlob: opt.caseGlob, keepTemp: opt.keepTemp });
  log(`${opt.plugin} ${version}: ${plan.length} cases in ${relative(root, suiteDir)}/`);
  for (const p of plan) log(`  ${p.case}: ${p.graders.length} graders${p.files.length ? `, ${p.files.length} files` : ''}${p.deps ? `, deps ${p.deps.hash}` : ''}${p.go ? ', go' : ''}`);
  for (const s of sets) log(`dependency cache ${relative(root, join(depsRoot, s.hash))}/: ${JSON.stringify(s.manifest)}`);
  log(`run (suite staged at ${relative(root, stageDir)}/ for the run, then removed): claude ${args.join(' ')}`);
  if (opt.dryRun) return 0;
  // The eval sandbox has no network: install dependencies now; the scaffolds copy them in.
  prepareDeps(depsRoot, sets, { run, log });

  // The CLI only accepts an --eval-dir that is relative and inside the plugin, with no
  // dot-prefixed segment: stage the suite there (gitignored) just for the run.
  rmSync(stageDir, { recursive: true, force: true });
  cpSync(suiteDir, stageDir, { recursive: true });
  let r;
  try {
    r = run('claude', args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    if (existsSync(join(stageDir, 'results'))) cpSync(join(stageDir, 'results'), join(outDir, 'results'), { recursive: true });
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
  if (r.error) throw new Error(`could not run claude: ${r.error.message}`);
  if (!existsSync(jsonFile)) throw new Error(`claude plugin eval exited ${r.status} without writing ${relative(root, jsonFile)}`);
  const json = JSON.parse(readFileSync(jsonFile, 'utf8'));
  const summary = parseEvalJson(json);
  log(formatTable(summary));
  if (opt.keepTemp) {
    // Evidence that the toolchains ran offline in the sandbox (traces only survive --keep-temp).
    for (const c of json.cases ?? []) {
      for (const [arm, runs] of Object.entries(c.arms ?? {})) {
        for (const r of runs ?? []) {
          if (!r?.tracePath || !existsSync(r.tracePath)) continue;
          for (const t of toolchainCalls(readFileSync(r.tracePath, 'utf8'))) {
            log(`  [${c.name} ${arm}] $ ${t.command.split('\n')[0]}${t.is_error ? '  (exit != 0)' : ''}\n      ${(t.output ?? '').split('\n').join('\n      ')}`);
          }
        }
      }
    }
  }
  if (opt.record) {
    if (summary.with.total === 0) throw new Error('no expectation results parsed; not recording');
    if (summary.partial) throw new Error(`partial run (${summary.partial}); not recording`);
    if (summary.errors.length) throw new Error(`${summary.errors.length} run(s) did not finish (${summary.errors.join('; ')}); not recording`);
    const rec = resultRecord({ plugin: opt.plugin, version, summary });
    appendResult(join(root, 'evals/results.json'), rec);
    log(`recorded in evals/results.json: ${JSON.stringify(rec)}`);
  }
  return r.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (e) { console.error(`eval: ${e.message}`); process.exitCode = 2; }
}
