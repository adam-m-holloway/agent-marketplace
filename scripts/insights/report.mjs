// Pure renderers for insights rows: CATALOGUE.md (data branch), the run summary, and the
// per-plugin view the site uses (it reads latest/consumers.json `rows` and groups by plugin).

export const HONESTY = 'Committed intent per repo (from .claude/settings.json), not what each laptop has installed.';

const byStr = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
const cell = (v) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|'));
const short = (sha) => (sha ? sha.slice(0, 7) : null);

export function consumersByPlugin(rows) {
  const out = {};
  for (const r of [...rows].sort(byStr((r) => `${r.plugin}\u0000${r.consumer}\u0000${r.channel}`))) {
    (out[r.plugin] ??= []).push({
      consumer: r.consumer, team: r.team, channel: r.channel, version: r.version,
      versions_behind: r.versions_behind, since: r.first_seen, status: r.status,
    });
  }
  return out;
}

function behindText(n) {
  if (n === null || n === undefined) return '—';
  return n === 0 ? 'up to date' : `${n} version${n === 1 ? '' : 's'} behind`;
}

export function renderCatalogueMd(rows, { generatedAt }) {
  const lines = ['# Plugin consumers', '', `> ${HONESTY}`, '', `Generated ${generatedAt}. "Since" = first committed to settings.`, ''];
  const grouped = consumersByPlugin(rows);
  const plugins = Object.keys(grouped);
  if (!plugins.length) lines.push('No consumers recorded.', '');
  for (const p of plugins) {
    lines.push(`## ${p}`, '', '| Consumer | Team | Channel | Version | Behind | Since | Status |', '|---|---|---|---|---|---|---|');
    for (const c of grouped[p]) {
      lines.push(`| ${cell(c.consumer)} | ${cell(c.team)} | ${cell(c.channel)} | ${cell(c.version)} | ${behindText(c.versions_behind)} | ${cell(c.since)} | ${cell(c.status)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** health: [{consumer, team, result: 'ok'|'removed'|'unknown', http, note}] */
export function renderSummary(rows, health = []) {
  const date = rows[0]?.date ?? '';
  const lines = [`## Insights scan ${date}`.trim(), '', `> ${HONESTY}`, ''];

  lines.push('### Consumers by channel', '');
  const channels = [...new Set(rows.map((r) => r.channel))].sort();
  if (!channels.length) lines.push('No consumers recorded.', '');
  for (const ch of channels) {
    lines.push(`**${ch}**`, '', '| Consumer | Plugin | Ref | SHA | Version | Since | Status |', '|---|---|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.channel === ch).sort(byStr((x) => `${x.consumer}\u0000${x.plugin}`))) {
      lines.push(`| ${cell(r.consumer)} | ${cell(r.plugin)} | ${cell(r.ref)} | ${cell(short(r.sha))} | ${cell(r.version)} | ${cell(r.first_seen)} | ${cell(r.status)} |`);
    }
    lines.push('');
  }

  lines.push('### Who is behind', '');
  const behind = rows.filter((r) => r.status !== 'removed' && r.versions_behind > 0);
  if (!behind.length) lines.push('Nobody is behind.');
  for (const r of behind) lines.push(`- ${r.team} (${r.consumer}): ${r.plugin} ${r.version} on ${r.channel} is ${behindText(r.versions_behind)}`);
  lines.push('');

  lines.push('### Scan health', '');
  const bad = health.filter((h) => h.result === 'unknown');
  if (health.some((h) => h.http === 401)) lines.push('**Token invalid or expired** (HTTP 401): check the insights token.', '');
  lines.push(bad.length ? `${bad.length} of ${health.length} consumer scans failed; previous data kept as \`unknown\`.` : `All ${health.length} consumer scans succeeded.`, '');
  if (health.length) {
    lines.push('| Consumer | Result | HTTP | Note |', '|---|---|---|---|');
    for (const h of health) {
      const note = h.http === 401 ? `token invalid or expired: ${h.note}` : h.note;
      lines.push(`| ${cell(h.consumer)} | ${cell(h.result)} | ${cell(h.http)} | ${cell(note)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
