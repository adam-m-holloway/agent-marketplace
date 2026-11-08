import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import {
  buildEvalDir, concretePaths, workspacePath, parseEvalJson, resultRecord, appendResult,
  parseArgs, cliArgs, formatTable, main, PROMPT_KEYS,
  depsManifest, depsHash, isNodeCase, scaffoldScript, depsToInstall, prepareDeps, toolchainCalls,
  DEFAULT_PACKAGE_JSON, NPM_INSTALL_ARGS,
} from '../scripts/eval.mjs';
import { evalsFor } from '../scripts/scores.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';

/** A fixture plugin with one skill, two cases (one with files). */
function fixturePlugin() {
  const root = mkdtempSync(join(tmpdir(), 'eval-'));
  const plugin = join(root, 'plugins', 'demo');
  const skill = join(plugin, 'skills', 'demo-skill');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'demo', version: '1.2.3' }));
  mkdirSync(join(skill, 'evals/files/fx/src'), { recursive: true });
  writeFileSync(join(skill, 'evals/files/fx/src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(skill, 'evals/files/fx/package.json'), '{}\n');
  writeFileSync(join(skill, 'evals/evals.json'), JSON.stringify({
    skill_name: 'demo-skill',
    evals: [
      { id: 2, prompt: 'Fix src/a.ts', expected_output: 'x', files: ['evals/files/fx/src/a.ts', 'evals/files/fx/package.json'],
        expectations: ['src/a.ts has no any', 'No file is created under docs/adr/'] },
      { id: 1, prompt: '  Write an ADR  ', expected_output: 'y', max_turns: 3, extra: 'dropped',
        expectations: ['docs/adr/README.md is created', 'Its path matches docs/adr/0001-[a-z0-9-]+.md'] },
    ],
  }));
  return { root, plugin };
}

const tree = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
};

test('buildEvalDir is deterministic (same tree on rebuild, cases sorted by id)', () => {
  const { root, plugin } = fixturePlugin();
  const plan1 = buildEvalDir(plugin, join(root, 'out1'));
  const plan2 = buildEvalDir(plugin, join(root, 'out1b'));
  assert.deepEqual(plan1, plan2);
  assert.deepEqual(tree(join(root, 'out1')), tree(join(root, 'out1b')));
  assert.deepEqual(plan1.map((p) => p.case), ['demo-skill-1', 'demo-skill-2']);
  // wipes stale files
  writeFileSync(join(root, 'out1', 'stale.txt'), 'x');
  buildEvalDir(plugin, join(root, 'out1'));
  assert.equal(existsSync(join(root, 'out1', 'stale.txt')), false);
});

test('prompt.md: only whitelisted frontmatter, prompt as body', () => {
  const { root, plugin } = fixturePlugin();
  const out = join(root, 'out');
  buildEvalDir(plugin, out);
  const md = readFileSync(join(out, 'demo-skill-1/prompt.md'), 'utf8');
  const { data, body } = parseFrontmatter(md);
  for (const k of Object.keys(data)) assert.ok(PROMPT_KEYS.includes(k), `unexpected key ${k}`);
  assert.equal(body.trim(), 'Write an ADR');
  assert.ok(!md.includes('extra'));
});

test('graders: one llm per expectation, file_exists only for concrete created paths', () => {
  const { root, plugin } = fixturePlugin();
  const out = join(root, 'out');
  const plan = buildEvalDir(plugin, out);
  const g1 = readdirSync(join(out, 'demo-skill-1/graders')).sort();
  assert.deepEqual(g1, ['01-llm.md', '02-llm.md', 'file-docs-adr-readme-md.md']);
  const llm = readFileSync(join(out, 'demo-skill-1/graders/01-llm.md'), 'utf8');
  assert.equal(parseFrontmatter(llm).data.type, 'llm');
  assert.match(llm, /PASS if docs\/adr\/README\.md is created/);
  const fe = parseFrontmatter(readFileSync(join(out, 'demo-skill-1/graders/file-docs-adr-readme-md.md'), 'utf8')).data;
  assert.equal(fe.type, 'file_exists');
  assert.equal(fe.path, 'docs/adr/README.md');
  assert.deepEqual(plan[1].graders, ['01-llm', '02-llm', 'file-src-a-ts']);
});

test('concretePaths skips regexes, directories, negatives and dotted identifiers', () => {
  assert.deepEqual(concretePaths('docs/adr/README.md is created'), ['docs/adr/README.md']);
  assert.deepEqual(concretePaths('path matches docs/adr/0003-[a-z0-9-]+.md'), []);
  assert.deepEqual(concretePaths('No file is created under docs/adr/README.md'), []);
  assert.deepEqual(concretePaths('JSON.parse result and it.each, go test ./...'), []);
  assert.deepEqual(concretePaths('Every function in src/upload.ts.'), ['src/upload.ts']);
});

test('case files are copied into the workspace with the fixture prefix stripped', () => {
  const { root, plugin } = fixturePlugin();
  const out = join(root, 'out');
  const plan = buildEvalDir(plugin, out);
  assert.equal(workspacePath('evals/files/fx/src/a.ts'), 'src/a.ts');
  assert.deepEqual(plan[1].files, ['package.json', 'src/a.ts']);
  assert.equal(readFileSync(join(out, 'demo-skill-2/workspace/src/a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.equal(existsSync(join(out, 'demo-skill-1/workspace')), false);
});

test('real plugins convert (every evals.json case becomes a case dir)', () => {
  const ROOT = new URL('..', import.meta.url).pathname;
  for (const p of ['adr-helper', 'go-conventions', 'typescript-conventions']) {
    const out = mkdtempSync(join(tmpdir(), 'eval-real-'));
    const plan = buildEvalDir(join(ROOT, 'plugins', p), out);
    assert.ok(plan.length >= 3, p);
    for (const c of plan) assert.ok(existsSync(join(out, c.case, 'prompt.md')));
  }
});

test('args and claude argv', () => {
  assert.deepEqual(parseArgs(['x', '--max-cost-usd', '3', '--record']), { plugin: 'x', maxCost: '3', dryRun: false, record: true, caseGlob: null, keepTemp: false });
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['x', '--max-cost-usd', 'abc']), /positive/);
  const a = cliArgs({ plugin: 'x', evalDir: 'eval-build', jsonFile: '/r.json', maxCost: 3 });
  assert.deepEqual(a.slice(0, 3), ['plugin', 'eval', 'plugins/x']);
  for (const f of ['--no-publish', '--scaffold', '--trust-plugin']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--eval-dir') + 1], 'eval-build');
  assert.equal(a[a.indexOf('--json') + 1], '/r.json');
  assert.equal(a[a.indexOf('--ablation') + 1], 'with-without');
  assert.equal(a[a.indexOf('--runs') + 1], '1');
  assert.deepEqual(a.slice(-2), ['--max-cost-usd', '3']);
  assert.ok(!cliArgs({ plugin: 'x', evalDir: 'e', jsonFile: 'j' }).includes('--max-cost-usd'));
});

test('run: suite staged inside the plugin for the CLI, removed after; --record appends', () => {
  const { root } = fixturePlugin();
  mkdirSync(join(root, 'evals'));
  writeFileSync(join(root, 'evals/results.json'), JSON.stringify({ runs: [] }));
  let seen;
  const run = (cmd, args, o) => {
    seen = { cmd, args, cwd: o.cwd, staged: existsSync(join(root, 'plugins/demo/eval-build/demo-skill-2/workspace/src/a.ts')) };
    const ok = { graders: [{ name: '01-llm', passed: true }, { name: '02-llm', passed: true }] };
    writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({
      schemaVersion: 1, costUsd: 0.5, partial: false,
      cases: [{ name: 'demo-skill-1', arms: { with: [ok], without: [{ graders: [{ name: '01-llm', passed: false }, { name: '02-llm', passed: true }] }] } }],
    }));
    return { status: 0 };
  };
  const code = main(['demo', '--record'], { root, log: () => {}, run });
  assert.equal(code, 0);
  assert.equal(seen.cmd, 'claude');
  assert.equal(seen.cwd, root);
  assert.equal(seen.staged, true);
  assert.equal(seen.args[seen.args.indexOf('--eval-dir') + 1], 'eval-build');
  assert.equal(existsSync(join(root, 'plugins/demo/eval-build')), false);
  const [rec] = JSON.parse(readFileSync(join(root, 'evals/results.json'), 'utf8')).runs;
  assert.deepEqual([rec.plugin, rec.version, rec.method, rec.cost_usd], ['demo', '1.2.3', 'claude plugin eval', 0.5]);
  assert.deepEqual(rec.with_skill, { passed: 2, total: 2 });
  assert.deepEqual(rec.baseline, { passed: 1, total: 2 });
});

test('fixture cases get a scaffold script and case.yaml; others do not', () => {
  const { root, plugin } = fixturePlugin();
  const out = join(root, 'out');
  buildEvalDir(plugin, out);
  assert.match(readFileSync(join(out, 'demo-skill-2/case.yaml'), 'utf8'), /schema_version: "1.1"\nname: "demo-skill-2"\ncontext:\n  scaffold_script: scaffold.sh/);
  assert.match(readFileSync(join(out, 'demo-skill-2/scaffold.sh'), 'utf8'), /cp -R .*workspace\/\." \./);
  assert.equal(existsSync(join(out, 'demo-skill-1/case.yaml')), false);
});

test('parseEvalJson: v1 arms, expectation graders counted, unscored and file graders ignored', () => {
  const g = (name, passed, extra = {}) => ({ name, passed, ...extra });
  const json = {
    schemaVersion: 1,
    aggregates: { totalCostUsd: 1.25 },
    cases: [
      { name: 'a-1', arms: {
        with: [{ passed: true, graders: [g('01-llm', true), g('02-llm', true), g('file-x', true), g('skill', true, { scored: false })] }],
        without: [{ passed: false, graders: [g('01-llm', true), g('02-llm', false), g('file-x', false)] }] } },
      { name: 'a-2', arms: { with: [{ graders: [g('01-llm', false)] }], without: [{ graders: [g('01-llm', false)] }] } },
    ],
  };
  const s = parseEvalJson(json);
  assert.deepEqual(s.with, { passed: 2, total: 3 });
  assert.deepEqual(s.baseline, { passed: 1, total: 3 });
  assert.deepEqual(s.cases.map((c) => [c.case, c.passed, c.baseline_passed]), [['a-1', true, false], ['a-2', false, false]]);
  assert.equal(s.cost_usd, 1.25);
  assert.match(formatTable(s), /delta: \+1/);
  assert.equal(parseEvalJson({ cases: [{ name: 'b', arms: { with: [{ graders: [g('01-llm', true)] }] } }] }).baseline, null);
  assert.equal(parseEvalJson({ partialReason: 'cost_ceiling', cases: [] }).partial, 'cost_ceiling');
});

test('record appends a run that scores.mjs evalsFor picks up', () => {
  const { root } = fixturePlugin();
  const file = join(root, 'results.json');
  writeFileSync(file, JSON.stringify({ runs: [{ plugin: 'demo', version: '1.0.0', measured_at: '2026-01-01T00:00:00Z', with_skill: { passed: 1, total: 2 }, baseline: null }] }));
  const summary = { cases: [], with: { passed: 3, total: 4 }, baseline: { passed: 2, total: 4 }, cost_usd: 1.5 };
  const rec = resultRecord({ plugin: 'demo', version: '1.2.3', summary, now: new Date('2026-11-08T12:00:00.123Z') });
  assert.equal(rec.measured_at, '2026-11-08T12:00:00Z');
  appendResult(file, rec);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /"with_skill": \{ "passed": 1, "total": 2 \}/); // old runs keep the compact style
  const data = JSON.parse(text);
  assert.equal(data.runs.length, 2);
  const e = evalsFor(data, 'demo', '1.2.3');
  assert.equal(e.pass_rate, 75);
  assert.equal(e.baseline_pass_rate, 50);
  assert.equal(e.measured_version, '1.2.3');
  assert.equal(e.method, 'claude plugin eval');
});

test('dry-run builds and prints the plan without running claude', () => {
  const { root } = fixturePlugin();
  const lines = [];
  const code = main(['demo', '--dry-run'], { root, log: (l) => lines.push(l), run: () => { throw new Error('ran'); } });
  assert.equal(code, 0);
  assert.ok(existsSync(join(root, 'eval-build/demo/suite/demo-skill-1/prompt.md')));
  assert.equal(existsSync(join(root, 'plugins/demo/eval-build')), false);
  assert.match(lines.join('\n'), /2 cases/);
});

// ---------- offline dependency cache ----------

/** A TS-like fixture plugin: case 1 has no files, case 2 ships a package.json; plus an ADR case. */
function tsFixturePlugin() {
  const root = mkdtempSync(join(tmpdir(), 'eval-ts-'));
  const plugin = join(root, 'plugins', 'ts');
  const skill = join(plugin, 'skills', 'ts-skill');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ts', version: '0.1.0' }));
  mkdirSync(join(skill, 'evals/files/proj/src'), { recursive: true });
  writeFileSync(join(skill, 'evals/files/proj/src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(skill, 'evals/files/proj/package.json'), JSON.stringify({ name: 'p', devDependencies: { vitest: '^2', typescript: '^5' } }));
  writeFileSync(join(skill, 'evals/evals.json'), JSON.stringify({
    evals: [
      { id: 1, prompt: 'Add src/b.ts to this TypeScript project', expectations: ['runs npx tsc --noEmit'] },
      { id: 2, prompt: 'Fix it', files: ['evals/files/proj/package.json', 'evals/files/proj/src/a.ts'], expectations: ['vitest passes'] },
      { id: 3, prompt: 'Write an ADR', expectations: ['an ADR exists'] },
    ],
  }));
  return { root, plugin };
}

const SCAFFOLD_SH_TEXT = '#!/bin/sh\nset -e\ncp -R "$(dirname "$0")/workspace/." .\n';

test('depsManifest keeps only sorted dependency fields; equal deps share a hash', () => {
  const a = depsManifest({ name: 'a', scripts: { test: 'x' }, devDependencies: { vitest: '^2', typescript: '^5' } });
  const b = depsManifest({ name: 'b', version: '9', devDependencies: { typescript: '^5', vitest: '^2' }, dependencies: {} });
  assert.deepEqual(a, { name: 'eval-deps', private: true, devDependencies: { typescript: '^5', vitest: '^2' } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(depsHash(a), depsHash(b));
  assert.match(depsHash(a), /^[0-9a-f]{16}$/);
  assert.notEqual(depsHash(a), depsHash(depsManifest(DEFAULT_PACKAGE_JSON)));
  assert.deepEqual(DEFAULT_PACKAGE_JSON.devDependencies, { typescript: '7.0.2', vitest: '5.1.0' });
});

test('isNodeCase: needs package.json fixtures in the skill and a TS/npm mention', () => {
  assert.equal(isNodeCase({ prompt: 'Add a TypeScript module' }, true), true);
  assert.equal(isNodeCase({ prompt: 'x', expectations: ['reports npx vitest run'] }, true), true);
  assert.equal(isNodeCase({ prompt: 'Write an ADR' }, true), false);
  assert.equal(isNodeCase({ prompt: 'Add a TypeScript module' }, false), false);
});

test('scaffoldScript: node_modules copy (quoted) and guarded go env', () => {
  assert.equal(scaffoldScript(), SCAFFOLD_SH_TEXT);
  const node = scaffoldScript({ nodeModules: "/c/it's/node_modules" });
  assert.ok(node.includes("if [ ! -e node_modules ]; then cp -R '/c/it'\\''s/node_modules' ./node_modules; fi\n"), node);
  const go = scaffoldScript({ go: true, realHome: '/Users/me' });
  assert.ok(go.includes(`[ "$HOME" != '/Users/me' ]`), go);
  for (const kv of ['GOTOOLCHAIN=local', 'GOFLAGS=-mod=mod', 'GOPROXY=off', 'GOCACHE="$PWD/.cache/go-build"', 'GOPATH="$PWD/.cache/go"']) assert.ok(go.includes(kv), kv);
  assert.ok(!go.includes('node_modules'));
});

test('buildEvalDir: TS cases get deps (and a generated project when missing); scaffold copies the cache', () => {
  const { root, plugin } = tsFixturePlugin();
  const out = join(root, 'out');
  const depsRoot = join(root, 'deps');
  const plan = buildEvalDir(plugin, out, { depsRoot });
  const [c1, c2, c3] = plan;
  assert.deepEqual(c1.files, ['package.json', 'tsconfig.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(out, c1.case, 'workspace/package.json'), 'utf8')), DEFAULT_PACKAGE_JSON);
  assert.equal(c1.deps.hash, depsHash(depsManifest(DEFAULT_PACKAGE_JSON)));
  assert.deepEqual(c2.files, ['package.json', 'src/a.ts', 'tsconfig.json']);
  assert.equal(c2.deps.hash, depsHash(depsManifest({ devDependencies: { typescript: '^5', vitest: '^2' } })));
  assert.equal(c3.deps, null);
  assert.equal(existsSync(join(out, c3.case, 'workspace')), false);
  assert.ok(readFileSync(join(out, c2.case, 'scaffold.sh'), 'utf8').includes(`'${join(depsRoot, c2.deps.hash, 'node_modules')}'`));
  assert.deepEqual(depsToInstall(plan).map((s) => s.hash), [c1.deps.hash, c2.deps.hash]);
  assert.equal(depsToInstall([...plan, c2]).length, 2);
  // the plugin tree is never written to
  assert.deepEqual(readdirSync(join(plugin, 'skills/ts-skill/evals/files/proj')).sort(), ['package.json', 'src']);
});

test('generated scaffold really copies the fixture and the cached node_modules', () => {
  const { root, plugin } = tsFixturePlugin();
  const depsRoot = join(root, 'deps');
  const [, c2] = buildEvalDir(plugin, join(root, 'out'), { depsRoot });
  mkdirSync(join(depsRoot, c2.deps.hash, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(depsRoot, c2.deps.hash, 'node_modules/.bin/tsc'), 'x');
  const ws = join(root, 'ws');
  mkdirSync(ws);
  const r = spawnSync('sh', [join(root, 'out', c2.case, 'scaffold.sh')], { cwd: ws, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(ws, 'src/a.ts')));
  assert.ok(existsSync(join(ws, 'node_modules/.bin/tsc')));
});

test('prepareDeps installs each set once, reuses ready entries, and fails loudly', () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-deps-'));
  const calls = [];
  const run = (cmd, args, o) => { calls.push({ cmd, args, cwd: o.cwd }); mkdirSync(join(o.cwd, 'node_modules')); return { status: 0 }; };
  const sets = [{ hash: 'h1', manifest: { name: 'eval-deps', private: true, devDependencies: { vitest: '^2' } } }];
  assert.deepEqual(prepareDeps(root, sets, { run, log: () => {} }), [{ hash: 'h1', cached: false }]);
  assert.deepEqual(calls, [{ cmd: 'npm', args: NPM_INSTALL_ARGS, cwd: join(root, 'h1') }]);
  assert.ok(NPM_INSTALL_ARGS.includes('--ignore-scripts'));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'h1/package.json'), 'utf8')), sets[0].manifest);
  assert.deepEqual(prepareDeps(root, sets, { run, log: () => {} }), [{ hash: 'h1', cached: true }]);
  assert.equal(calls.length, 1);
  const bad = [{ hash: 'h2', manifest: {} }];
  assert.throws(() => prepareDeps(root, bad, { run: () => ({ status: 1 }), log: () => {} }), /npm install failed .*h2.*exit 1/);
  assert.equal(existsSync(join(root, 'h2/.ready')), false);
});

test('main installs dependencies before running claude; --keep-temp passes through', () => {
  const { root } = tsFixturePlugin();
  const seen = [];
  const run = (cmd, args, o) => {
    seen.push(cmd);
    if (cmd === 'npm') { mkdirSync(join(o.cwd, 'node_modules')); return { status: 0 }; }
    writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({ cases: [{ name: 'x', arms: { with: [{ graders: [{ name: '01-llm', passed: true }] }] } }] }));
    return { status: 0 };
  };
  assert.equal(main(['ts'], { root, log: () => {}, run }), 0);
  assert.deepEqual(seen, ['npm', 'npm', 'claude']);
  assert.ok(existsSync(join(root, 'eval-build/.deps')));
  assert.equal(parseArgs(['x', '--keep-temp']).keepTemp, true);
  assert.ok(cliArgs({ plugin: 'x', evalDir: 'e', jsonFile: 'j', keepTemp: true }).includes('--keep-temp'));
});

test('runs that did not finish (timeouts) are reported and block --record', () => {
  const ok = { graders: [{ name: '01-llm', passed: true }] };
  const json = { cases: [{ name: 'c1', arms: { with: [{ ...ok, error: 'timed out after 600s' }], without: [ok] } }] };
  const s = parseEvalJson(json);
  assert.deepEqual(s.errors, ['c1 with: timed out after 600s']);
  assert.match(formatTable(s), /did not finish \(1\): c1 with: timed out/);
  assert.deepEqual(parseEvalJson({ cases: [{ name: 'c', arms: { with: [ok] } }] }).errors, []);
  const { root } = fixturePlugin();
  mkdirSync(join(root, 'evals'));
  writeFileSync(join(root, 'evals/results.json'), JSON.stringify({ runs: [] }));
  const run = (cmd, args) => { writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify(json)); return { status: 1 }; };
  assert.throws(() => main(['demo', '--record'], { root, log: () => {}, run }), /1 run\(s\) did not finish .*not recording/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'evals/results.json'), 'utf8')).runs, []);
});

test('toolchainCalls pairs toolchain Bash calls with their output', () => {
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npx tsc --noEmit' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'src/a.ts(1,1): error TS2322\n\nmore\nx\ny\nz' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'a' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'go test ./...' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: 'ok  example.com/p' }] }] } },
  ];
  const calls = toolchainCalls(lines.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');
  assert.deepEqual(calls, [
    { command: 'npx tsc --noEmit', output: 'src/a.ts(1,1): error TS2322\nmore\nx\ny', is_error: true },
    { command: 'go test ./...', output: 'ok  example.com/p', is_error: false },
  ]);
});
