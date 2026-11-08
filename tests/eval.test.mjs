import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  buildEvalDir, concretePaths, workspacePath, parseEvalJson, resultRecord, appendResult,
  parseArgs, cliArgs, formatTable, main, PROMPT_KEYS,
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
  assert.deepEqual(parseArgs(['x', '--max-cost-usd', '3', '--record']), { plugin: 'x', maxCost: '3', dryRun: false, record: true, caseGlob: null });
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
