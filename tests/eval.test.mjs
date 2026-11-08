import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, cliArgs, summarise, resultRecord, appendResult, formatTable, main, MODEL, JUDGE_MODEL, MAX_COST_USD } from '../scripts/eval.mjs';
import { evalsFor } from '../scripts/scores.mjs';
import { loadSuite, classify, suiteCounts } from '../scripts/lib/plugin-evals.mjs';
import { loadRepo } from '../scripts/lib/plugins.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A `claude plugin eval --json` document (schemaVersion 1), trimmed to the fields we read. */
const DOC = {
  schemaVersion: 1,
  claudeVersion: '2.1.300',
  costUsd: 0.4321,
  partial: false,
  aggregates: { overallScore: 0.8333, casesPassed: 2, casesTotal: 3, meanDelta: 0.4444 },
  cases: [
    { name: 'a', aggregates: { score: 1, delta: 1 } },
    { name: 'b', aggregates: { score: 1, delta: 0 } },
    { name: 'c', aggregates: { score: 0.5 } },
  ],
};

test('parseArgs: defaults pin models, cost ceiling and with-without ablation; bad values fail', () => {
  const o = parseArgs(['conventional-commits']);
  assert.deepEqual([o.plugin, o.model, o.judgeModel, o.maxCost, o.ablation, o.runs], ['conventional-commits', MODEL, JUDGE_MODEL, MAX_COST_USD, 'with-without', null]);
  const p = parseArgs(['x', '--runs', '1', '--max-cost-usd', '1', '--case', 'trigger-*', '--tag', 'trigger', '--ablation', 'none', '--model', 'm', '--judge-model', 'j', '--keep-temp']);
  assert.deepEqual([p.runs, p.maxCost, p.caseGlob, p.tag, p.ablation, p.model, p.judgeModel, p.keepTemp], ['1', '1', 'trigger-*', 'trigger', 'none', 'm', 'j', true]);
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['x', '--max-cost-usd', '0']), /positive/);
  assert.throws(() => parseArgs(['x', '--runs', 'two']), /positive integer/);
  assert.throws(() => parseArgs(['x', '--ablation', 'both']), /with-without or none/);
  assert.throws(() => parseArgs(['x', '--bogus']), /unknown argument/);
});

test('cliArgs: target first, pinned models, cost, json, no publish, scaffold; list option last', () => {
  const a = cliArgs(parseArgs(['p', '--runs', '1', '--case', 'c*']), { jsonFile: '/o/result.json', outDir: '/o/report' });
  assert.deepEqual(a.slice(0, 3), ['plugin', 'eval', 'plugins/p']);
  const at = (k) => a[a.indexOf(k) + 1];
  assert.equal(at('--model'), MODEL);
  assert.equal(at('--judge-model'), JUDGE_MODEL);
  assert.equal(at('--ablation'), 'with-without');
  assert.equal(at('--max-cost-usd'), String(MAX_COST_USD));
  assert.equal(at('--runs'), '1');
  assert.equal(at('--case'), 'c*');
  assert.equal(at('--output-dir'), '/o/report');
  for (const f of ['--no-publish', '--scaffold', '--trust-plugin']) assert.ok(a.includes(f), f);
  // --allow-tools takes a list, so only --json (with an explicit .json path) may follow it.
  assert.deepEqual(a.slice(a.indexOf('--allow-tools')), ['--allow-tools', 'Bash', 'Edit', 'Write', '--json', '/o/result.json']);
});

test('summarise + resultRecord keep the aggregate fields, rounded; partial is detected', () => {
  const s = summarise(DOC);
  assert.deepEqual([s.overall_score, s.mean_delta, s.cases_passed, s.cases_total, s.cost_usd, s.claude_version, s.partial], [0.8333, 0.4444, 2, 3, 0.4321, '2.1.300', null]);
  assert.deepEqual(s.cases[2], { name: 'c', score: 0.5, delta: null });
  assert.equal(summarise({ ...DOC, partial: true, partialReason: 'cost_ceiling' }).partial, 'cost_ceiling');
  const rec = resultRecord({ plugin: 'p', version: '1.0.1', summary: s, opt: parseArgs(['p']), now: new Date('2026-11-08T20:00:00.123Z') });
  assert.deepEqual(rec, {
    plugin: 'p', version: '1.0.1', measured_at: '2026-11-08T20:00:00Z', method: 'claude plugin eval',
    overall_score: 0.833, mean_delta: 0.444, cases_passed: 2, cases_total: 3, cost_usd: 0.43,
    claude_version: '2.1.300', model: MODEL, judge_model: JUDGE_MODEL, ablation: 'with-without',
  });
  assert.match(formatTable(s), /overall 0\.83 {3}mean delta \+0\.44 {3}cases passed 2\/3 {3}cost \$0\.43/);
});

test('a native record is what scores.mjs evalsFor reads; old skill-creator runs still read', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'evres-')), 'results.json');
  cpSync(join(ROOT, 'evals/results.json'), file);
  const before = readFileSync(file, 'utf8');
  const rec = resultRecord({ plugin: 'go-conventions', version: '1.0.1', summary: summarise(DOC), opt: parseArgs(['go-conventions']) });
  appendResult(file, rec);
  const after = readFileSync(file, 'utf8');
  assert.ok(after.startsWith(before.replace(/\n {2}\]\n\}\n$/, '')), 'old runs are byte-identical');
  const data = JSON.parse(after);
  const e = evalsFor(data, 'go-conventions', '1.0.1');
  assert.deepEqual([e.pass_rate, e.delta, e.baseline_pass_rate, e.passed, e.total, e.unit], [83.3, 44.4, 38.9, 2, 3, 'cases']);
  const old = evalsFor(data, 'go-conventions', '1.0.0');
  assert.deepEqual([old.passed, old.baseline_passed, old.delta, old.unit], [19, 16, 13.7, 'expectations']);
});

function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'evalrun-'));
  mkdirSync(join(root, 'plugins/p/.claude-plugin'), { recursive: true });
  writeFileSync(join(root, 'plugins/p/.claude-plugin/plugin.json'), JSON.stringify({ name: 'p', version: '1.2.0' }));
  mkdirSync(join(root, 'evals'));
  writeFileSync(join(root, 'evals/results.json'), JSON.stringify({ runs: [] }));
  return root;
}
const fakeClaude = (doc, status = 0) => {
  const calls = [];
  return { calls, run: (cmd, args, o) => { calls.push({ cmd, args, cwd: o.cwd }); writeFileSync(args.at(-1), JSON.stringify(doc)); return { status }; } };
};

test('main runs claude from the repo root and records a full run; partial and filtered runs are not recorded', () => {
  const root = fakeRepo();
  const log = [];
  const c = fakeClaude(DOC, 1);
  assert.equal(main(['p', '--runs', '1'], { root, run: c.run, log: (m) => log.push(m) }), 1);
  assert.equal(c.calls[0].cmd, 'claude');
  assert.equal(c.calls[0].cwd, root);
  assert.equal(c.calls[0].args.at(-1), join(root, 'eval-build/p/result.json'));
  let runs = JSON.parse(readFileSync(join(root, 'evals/results.json'), 'utf8')).runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].version, '1.2.0');

  main(['p'], { root, run: fakeClaude({ ...DOC, partial: true, partialReason: 'cost_ceiling' }, 2).run, log: (m) => log.push(m) });
  main(['p', '--tag', 'trigger'], { root, run: fakeClaude(DOC).run, log: (m) => log.push(m) });
  runs = JSON.parse(readFileSync(join(root, 'evals/results.json'), 'utf8')).runs;
  assert.equal(runs.length, 1);
  assert.match(log.join('\n'), /not recorded: partial run \(cost_ceiling\)/);
  assert.match(log.join('\n'), /not recorded: --case \/ --tag/);
});

test('main: dry run prints the command only; unknown plugin and missing JSON fail', () => {
  const root = fakeRepo();
  const log = [];
  let ran = false;
  assert.equal(main(['p', '--dry-run'], { root, run: () => { ran = true; }, log: (m) => log.push(m) }), 0);
  assert.equal(ran, false);
  assert.match(log[0], /^p 1\.2\.0: claude plugin eval plugins\/p /);
  assert.throws(() => main(['nope'], { root, log: () => {} }), /no plugin at plugins\/nope/);
  assert.throws(() => main(['p'], { root, run: () => ({ status: 1 }), log: () => {} }), /without writing/);
});

test('real plugins: native suites load and meet the per-skill minimums', () => {
  const repo = loadRepo(ROOT);
  for (const p of repo.plugins) {
    const suite = loadSuite(ROOT, p.path);
    const counts = suiteCounts(suite, p.skills.map((s) => s.name));
    for (const [s, n] of Object.entries(counts)) {
      assert.ok(n.behaviour >= 3 && n.trigger >= 8 && n.noTrigger >= 8, `${p.dir}/${s}: ${JSON.stringify(n)}`);
    }
    for (const c of suite.cases) {
      assert.equal(c.prompt?.error, undefined, c.path);
      assert.ok(c.graders.length && c.graders.every((g) => !g.error), c.path);
      if (classify(c, p.skills.map((s) => s.name)).kind === 'behaviour') {
        assert.ok(c.graders.some((g) => g.data.type !== 'llm' && g.data.tool !== 'Skill'), `${c.path}: needs a deterministic grader`);
        assert.ok(c.graders.filter((g) => g.data.type === 'llm').length <= 1, `${c.path}: at most one llm grader`);
      }
    }
  }
});

test('scaffold scripts copy the case workspace into an empty directory', () => {
  const caseDir = join(ROOT, 'plugins/conventional-commits/evals/write-commit-message/feature-commit-message');
  const ws = mkdtempSync(join(tmpdir(), 'scaffold-'));
  const r = spawnSync('sh', [join(caseDir, 'scaffold.sh')], { cwd: ws, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(ws, 'staged.diff')));
  assert.ok(existsSync(join(ws, 'src/invoices/routes.ts')));
});
