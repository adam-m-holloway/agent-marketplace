import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planBehindIssues, planDailyReport, behindMarker, DAILY_MARKER, REPORT_TITLE, applyPlan, readData, main,
} from '../scripts/insights/issues.mjs';

const row = (o) => ({
  date: '2026-11-08', consumer: 'org/team-b', team: 'team-b', channel: 'stable', marketplace: 'agent-marketplace-stable',
  plugin: 'adr-helper', ref: 'stable', sha: 'abc', version: '1.0.0', versions_behind: 1, first_seen: '2026-11-08', status: 'active', ...o,
});
const ROWS = [
  row({}),
  row({ consumer: 'org/team-a', team: 'team-a', channel: 'latest', version: '1.1.0', versions_behind: 0 }),
  row({ plugin: 'go-conventions', consumer: 'org/team-a', team: 'team-a', channel: 'latest', versions_behind: 2 }),
];
const issue = (number, marker, extra = {}) => ({ number, title: 't', body: `${marker}\nold`, ...extra });

test('behindMarker is stable per plugin + consumer', () => {
  assert.equal(behindMarker('adr-helper', 'org/team-b'), '<!-- insights:behind:adr-helper:org/team-b -->');
});

test('planBehindIssues opens one issue per behind (plugin, consumer) with the agreed title and labels', () => {
  const plan = planBehindIssues(ROWS, []);
  assert.deepEqual(plan.map((p) => [p.action, p.title]), [
    ['create', 'Behind: adr-helper — team-b on stable is 1 version behind'],
    ['create', 'Behind: go-conventions — team-a on latest is 2 versions behind'],
  ]);
  for (const p of plan) {
    assert.deepEqual(p.labels, ['insights', 'behind']);
    assert.ok(p.body.startsWith('<!-- insights:behind:'));
  }
  assert.match(plan[0].body, /org\/team-b/);
  assert.match(plan[0].body, /1\.0\.0/);
});

test('planBehindIssues is idempotent: an open issue with the same marker and body is left alone', () => {
  const first = planBehindIssues(ROWS, []);
  const existing = first.map((p, i) => ({ number: 10 + i, title: p.title, body: p.body }));
  assert.deepEqual(planBehindIssues(ROWS, existing), []);
});

test('planBehindIssues updates the title when the gap changes, and closes resolved or removed ones', () => {
  const rows = [
    row({ versions_behind: 2, version: '0.9.0' }),
    row({ plugin: 'go-conventions', consumer: 'org/team-a', team: 'team-a', channel: 'latest', versions_behind: 0 }),
    row({ plugin: 'typescript-conventions', status: 'removed', versions_behind: 1 }),
  ];
  const existing = [
    issue(1, behindMarker('adr-helper', 'org/team-b')),
    issue(2, behindMarker('go-conventions', 'org/team-a')),
    issue(3, behindMarker('typescript-conventions', 'org/team-b')),
    issue(4, behindMarker('gone-plugin', 'org/team-z')),
    { number: 5, title: 'unrelated', body: 'no marker' },
  ];
  const plan = planBehindIssues(rows, existing);
  assert.deepEqual(plan.map((p) => [p.action, p.number]), [['update', 1], ['close', 2], ['close', 3], ['close', 4]]);
  assert.equal(plan[0].title, 'Behind: adr-helper — team-b on stable is 2 versions behind');
  assert.match(plan[1].comment, /up to date/i);
  assert.match(plan[2].comment, /no longer/i);
});

test('planBehindIssues leaves an issue open when the latest scan of that consumer is unknown', () => {
  const rows = [row({ status: 'unknown', versions_behind: 1 })];
  assert.deepEqual(planBehindIssues(rows, [issue(1, behindMarker('adr-helper', 'org/team-b'))]), []);
  assert.deepEqual(planBehindIssues(rows, []), []);
});

const EVENTS = [{ date: '2026-11-08', type: 'version_changed', consumer: 'org/team-a', team: 'team-a', channel: 'latest', plugin: 'adr-helper', from_version: '1.0.0', to_version: '1.1.0' }];

test('planDailyReport creates and pins the single report issue, with a comment on change days', () => {
  const p = planDailyReport(ROWS, EVENTS, null, { date: '2026-11-08' });
  assert.equal(p.action, 'create');
  assert.equal(p.title, REPORT_TITLE);
  assert.equal(p.title, 'Plugin usage report');
  assert.deepEqual(p.labels, ['insights']);
  assert.equal(p.pin, true);
  assert.ok(p.body.startsWith(DAILY_MARKER));
  assert.match(p.body, /adr-helper/);
  assert.match(p.body, /team-b \(org\/team-b\): adr-helper 1\.0\.0 on stable is 1 version behind/);
  assert.match(p.comment, /<!-- insights:daily-report:2026-11-08 -->/);
  assert.match(p.comment, /version_changed adr-helper 1\.0\.0 → 1\.1\.0 \(team-a, latest\)/);
});

test('planDailyReport: no events → no comment; unchanged body → nothing to do', () => {
  const created = planDailyReport(ROWS, [], null, { date: '2026-11-08' });
  assert.equal(created.comment, null);
  const existing = { number: 7, title: REPORT_TITLE, body: created.body, comments: [] };
  assert.equal(planDailyReport(ROWS, [], existing, { date: '2026-11-08' }), null);
});

test('planDailyReport updates the existing issue and never comments twice for the same day', () => {
  const existing = { number: 7, title: REPORT_TITLE, body: `${DAILY_MARKER}\nold`, comments: [] };
  const p = planDailyReport(ROWS, EVENTS, existing, { date: '2026-11-08' });
  assert.equal(p.action, 'update');
  assert.equal(p.number, 7);
  assert.ok(p.comment);
  const again = { ...existing, body: p.body, comments: [{ body: p.comment }] };
  assert.equal(planDailyReport(ROWS, EVENTS, again, { date: '2026-11-08' }), null);
});

test('applyPlan issues the right gh commands (fake runner)', () => {
  const calls = [];
  const gh = (args, input) => { calls.push({ args, input }); return args[1] === 'create' ? 'https://github.com/o/r/issues/42\n' : ''; };
  applyPlan({
    behind: [
      { action: 'create', title: 'T', body: 'B', labels: ['insights', 'behind'] },
      { action: 'update', number: 1, title: 'T2', body: 'B2' },
      { action: 'close', number: 2, comment: 'C' },
    ],
    report: { action: 'create', title: REPORT_TITLE, body: 'R', labels: ['insights'], pin: true, comment: 'X' },
  }, gh, () => {});
  const cmds = calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.deepEqual(cmds, [
    'label create', 'label create',
    'issue create', 'issue edit', 'issue close',
    'issue create', 'issue pin', 'issue comment',
  ]);
  assert.deepEqual(calls[2].args, ['issue', 'create', '--title', 'T', '--body-file', '-', '--label', 'insights', '--label', 'behind']);
  assert.equal(calls[2].input, 'B');
  assert.deepEqual(calls[6].args, ['issue', 'pin', '42']);
  assert.deepEqual(calls[7].args, ['issue', 'comment', '42', '--body-file', '-']);
});

test('applyPlan: a failed pin is a warning, not a failure', () => {
  const warnings = [];
  const gh = (args) => {
    if (args[1] === 'pin') throw new Error('Resource not accessible by integration');
    return args[1] === 'create' ? 'https://github.com/o/r/issues/9\n' : '';
  };
  applyPlan({ behind: [], report: { action: 'create', title: REPORT_TITLE, body: 'R', labels: ['insights'], pin: true, comment: null } }, gh, (m) => warnings.push(m));
  assert.match(warnings.join('\n'), /could not pin/);
});

test('readData reads latest rows and that scan day\'s events; main --dry-run prints the plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issues-'));
  mkdirSync(join(dir, 'latest'), { recursive: true });
  mkdirSync(join(dir, 'events/year=2026/month=11'), { recursive: true });
  writeFileSync(join(dir, 'latest/consumers.json'), JSON.stringify({ generated_at: 'x', scan_date: '2026-11-08', rows: ROWS }));
  writeFileSync(join(dir, 'events/year=2026/month=11/2026-11-08.ndjson'), EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const d = readData(dir);
  assert.equal(d.date, '2026-11-08');
  assert.equal(d.rows.length, 3);
  assert.equal(d.events.length, 1);
  const out = [];
  const gh = (args) => { if (args[0] === 'issue' && args[1] === 'list') return '[]'; throw new Error(`unexpected ${args}`); };
  assert.equal(main(['--data', dir, '--dry-run'], { gh, log: (m) => out.push(m) }), 0);
  assert.match(out.join('\n'), /create: Behind: adr-helper/);
  assert.match(out.join('\n'), /create: Plugin usage report/);
});
