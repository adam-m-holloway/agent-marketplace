#!/usr/bin/env node
// Insights → GitHub issues (used by .github/workflows/insights.yml after the snapshot is pushed):
//   node scripts/insights/issues.mjs --data <dir of checked-out data branch> [--dry-run]
// - one "Behind: …" issue per (plugin, consumer) that is behind; closed when it catches up or
//   stops using the plugin;
// - one pinned "Plugin usage report" issue, edited each run, with a comment only on change days.
// Idempotent: existing issues are found by hidden marker comments, never by title. Needs `gh` and
// GH_TOKEN with issues: write. The planners are pure; only applyPlan/main touch GitHub.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HONESTY, consumersByPlugin } from './report.mjs';

export const REPORT_TITLE = 'Plugin usage report';
export const DAILY_MARKER = '<!-- insights:daily-report -->';
export const LABELS = {
  insights: { color: '245bf3', description: 'Opened by the nightly insights run' },
  behind: { color: 'e7b56a', description: 'A consumer is behind the latest plugin version' },
};
export const behindMarker = (plugin, consumer) => `<!-- insights:behind:${plugin}:${consumer} -->`;
const BEHIND_RE = /<!-- insights:behind:([^:\s]+):(\S+) -->/;
const dayMarker = (date) => `<!-- insights:daily-report:${date} -->`;

const versions = (n) => `${n} version${n === 1 ? '' : 's'}`;
const byStr = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
const isBehind = (r) => r.status === 'active' && r.versions_behind > 0;

function behindIssue(r) {
  return {
    title: `Behind: ${r.plugin} — ${r.team} on ${r.channel} is ${versions(r.versions_behind)} behind`,
    body: [
      behindMarker(r.plugin, r.consumer),
      `**${r.consumer}** (${r.team}) uses **${r.plugin} ${r.version}** on the **${r.channel}** channel, ` +
        `${versions(r.versions_behind)} behind that channel's newest release.`,
      '',
      r.channel === 'stable'
        ? 'Stable consumers catch up when a promotion reaches `stable` and they run `/plugin marketplace update`.'
        : 'Run `/plugin marketplace update` then `/plugin update` in the consumer repo.',
      '',
      `> ${HONESTY}`,
      '',
      '_Opened and closed automatically by the nightly insights run._',
    ].join('\n'),
  };
}

/**
 * @param rows latest/consumers.json rows
 * @param existingIssues open issues [{number, title, body}] (any; non-marker ones are ignored)
 * @returns [{action:'create', title, body, labels} | {action:'update', number, title, body} | {action:'close', number, comment}]
 */
export function planBehindIssues(rows, existingIssues) {
  const open = new Map();
  for (const i of existingIssues) {
    const m = BEHIND_RE.exec(i.body ?? '');
    if (m) open.set(`${m[1]}:${m[2]}`, i);
  }
  const rowByKey = new Map(rows.map((r) => [`${r.plugin}:${r.consumer}`, r]));
  const plan = [];
  for (const r of [...rows].filter(isBehind).sort(byStr((r) => `${r.plugin}\u0000${r.consumer}`))) {
    const want = behindIssue(r);
    const have = open.get(`${r.plugin}:${r.consumer}`);
    if (!have) plan.push({ action: 'create', ...want, labels: ['insights', 'behind'] });
    else if (have.title !== want.title || have.body !== want.body) plan.push({ action: 'update', number: have.number, ...want });
  }
  const closes = [];
  for (const [key, i] of open) {
    const r = rowByKey.get(key);
    if (r && (isBehind(r) || r.status === 'unknown')) continue; // still behind, or we can't tell
    const comment = r?.status === 'active'
      ? `Resolved: ${r.team} is now up to date (${r.plugin} ${r.version} on ${r.channel}).`
      : `Resolved: ${key.split(':')[1]} no longer uses this plugin.`;
    closes.push({ action: 'close', number: i.number, comment });
  }
  return [...plan, ...closes.sort((a, b) => a.number - b.number)];
}

function reportBody(rows, date) {
  const lines = [DAILY_MARKER, `Last insights scan: **${date}**.`, '', `> ${HONESTY}`, ''];
  const grouped = consumersByPlugin(rows.filter((r) => r.status !== 'removed'));
  lines.push('| Plugin | Teams | Up to date | Behind |', '|---|---|---|---|');
  const names = Object.keys(grouped);
  if (!names.length) lines.push('| — | — | — | — |');
  for (const p of names) {
    const cs = grouped[p];
    lines.push(`| ${p} | ${[...new Set(cs.map((c) => c.team))].join(', ')} | ${cs.filter((c) => c.versions_behind === 0).length} | ${cs.filter((c) => c.versions_behind > 0).length} |`);
  }
  lines.push('', '### Who is behind', '');
  const behind = rows.filter(isBehind).sort(byStr((r) => `${r.plugin}\u0000${r.consumer}`));
  if (!behind.length) lines.push('Nobody is behind.');
  for (const r of behind) lines.push(`- ${r.team} (${r.consumer}): ${r.plugin} ${r.version} on ${r.channel} is ${versions(r.versions_behind)} behind`);
  lines.push('', '_Edited by every nightly insights run; a comment is added only on days something changed._');
  return lines.join('\n');
}

function eventLine(e) {
  const v = e.type === 'version_changed' ? ` ${e.from_version} → ${e.to_version}`
    : e.type === 'added' ? ` ${e.to_version}` : e.from_version ? ` ${e.from_version}` : '';
  return `- ${e.type} ${e.plugin}${v} (${e.team}, ${e.channel})`;
}

/**
 * @param existing the open report issue {number, title, body, comments:[{body}]} or null
 * @returns null (nothing to do) | {action:'create', title, body, labels, pin, comment} | {action:'update', number, body, comment}
 *          comment is null unless events is non-empty and that day has no comment yet.
 */
export function planDailyReport(rows, events, existing, { date }) {
  const body = reportBody(rows, date);
  const alreadyCommented = (existing?.comments ?? []).some((c) => (c.body ?? '').includes(dayMarker(date)));
  const comment = events.length && !alreadyCommented
    ? [dayMarker(date), `### Changes on ${date}`, '', ...events.map(eventLine)].join('\n')
    : null;
  if (!existing) return { action: 'create', title: REPORT_TITLE, body, labels: ['insights'], pin: true, comment };
  if (existing.body === body && !comment) return null;
  return { action: 'update', number: existing.number, body, comment };
}

const numberFromUrl = (out) => {
  const m = /\/issues\/(\d+)\s*$/.exec(String(out).trim());
  if (!m) throw new Error(`could not read the new issue number from: ${out}`);
  return m[1];
};

/** Run the plan with an injectable gh(args, stdin) → stdout. */
export function applyPlan({ behind, report }, gh, warn = (m) => console.log(`::warning::${m}`)) {
  for (const [name, l] of Object.entries(LABELS)) gh(['label', 'create', name, '--color', l.color, '--description', l.description, '--force']);
  for (const p of behind) {
    if (p.action === 'create') gh(['issue', 'create', '--title', p.title, '--body-file', '-', ...p.labels.flatMap((l) => ['--label', l])], p.body);
    else if (p.action === 'update') gh(['issue', 'edit', String(p.number), '--title', p.title, '--body-file', '-'], p.body);
    else if (p.action === 'close') gh(['issue', 'close', String(p.number), '--comment', p.comment]);
  }
  if (!report) return;
  let number = report.number && String(report.number);
  if (report.action === 'create') {
    number = numberFromUrl(gh(['issue', 'create', '--title', report.title, '--body-file', '-', ...report.labels.flatMap((l) => ['--label', l])], report.body));
    if (report.pin) {
      try { gh(['issue', 'pin', number]); } catch (e) { warn(`could not pin issue #${number}: ${e.message}`); }
    }
  } else {
    gh(['issue', 'edit', number, '--body-file', '-'], report.body);
  }
  if (report.comment) gh(['issue', 'comment', number, '--body-file', '-'], report.comment);
}

/** latest/consumers.json rows + that scan day's events from a checked-out data branch. */
export function readData(dataDir) {
  const latest = JSON.parse(readFileSync(join(dataDir, 'latest/consumers.json'), 'utf8'));
  const date = latest.scan_date;
  const file = join(dataDir, 'events', `year=${date.slice(0, 4)}`, `month=${date.slice(5, 7)}`, `${date}.ndjson`);
  const events = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { date, rows: latest.rows ?? [], events };
}

const realGh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });

export function main(argv, { gh = realGh, log = console.log } = {}) {
  let data;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data') data = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
    else { log(`unknown argument: ${argv[i]}`); return 2; }
  }
  if (!data) { log('usage: node scripts/insights/issues.mjs --data <dir> [--dry-run]'); return 2; }
  const { date, rows, events } = readData(resolve(data));
  const open = JSON.parse(gh(['issue', 'list', '--label', 'insights', '--state', 'open', '--limit', '500', '--json', 'number,title,body,comments']));
  const reportIssue = open.find((i) => (i.body ?? '').startsWith(DAILY_MARKER)) ?? null;
  const plan = { behind: planBehindIssues(rows, open), report: planDailyReport(rows, events, reportIssue, { date }) };
  for (const p of plan.behind) log(`${p.action}: ${p.title ?? `#${p.number}`}`);
  log(plan.report ? `${plan.report.action}: ${plan.report.title ?? `#${plan.report.number}`}${plan.report.comment ? ' (+ change-day comment)' : ''}` : 'report: unchanged');
  if (!dryRun) applyPlan(plan, gh);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
