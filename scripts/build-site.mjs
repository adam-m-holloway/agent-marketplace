#!/usr/bin/env node
// Build the GitHub Pages catalogue: copy site/ into --out and write data.json.
// Usage: node scripts/build-site.mjs [--root .] [--out _site] [--skillspector skillspector.json] [--quality <reports dir>]
// Git reads (origin/stable, origin/data, release tags) are optional: a missing branch gives null / [].
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHANNELS, REPO, loadRepo, stableJson } from './lib/plugins.mjs';
import { buildCatalogues } from './lib/catalogue.mjs';
import { compare, parse } from './lib/semver.mjs';
import { related, RELATED_MIN_SCORE } from './similar.mjs';
import {
  SCORES_EXPLAINED, QUALITY_CRITERIA, isTracked, lastTrackedVersion, parseNdjson, readEvalsResults,
  readQualityReports, readSkillspector, scoreChange, scorePlugin, SECURITY_PENALTY, DOCS_K,
} from './scores.mjs';
import { BEST_PRACTICE_RULES } from './lib/best-practice.mjs';
import { MIN_CASES, MIN_TRIGGER_EACH } from './lib/rules/evals.mjs';
import { NEXT, MIN_DAYS, MIN_CONSUMERS, RETIRE_LABEL } from './lib/rules/stage-gate.mjs';

export const PAGES_URL = 'https://adam-m-holloway.github.io/agent-marketplace/';
export const CONSUMERS_NOTE = 'Committed intent per repo, not what each laptop has installed';

/** Minimal SKILL.md frontmatter read: name, description, compatibility (plain, quoted, or >/| blocks). */
export function skillMeta(md, fallbackName) {
  const meta = { name: fallbackName, description: '', compatibility: null };
  const m = typeof md === 'string' ? md.match(/^---\r?\n([\s\S]*?)\r?\n---/) : null;
  if (!m) return meta;
  const lines = m[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|][-+]?$/.test(val)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      val = val.startsWith('>') ? block.filter(Boolean).join(' ') : block.join('\n').trim();
    } else if (/^(["']).*\1$/.test(val)) {
      val = val.slice(1, -1);
    }
    data[key] = val;
  }
  if (data.name) meta.name = data.name;
  if (data.description) meta.description = data.description;
  if (data.compatibility) meta.compatibility = data.compatibility;
  return meta;
}

/** consumers.json rows grouped by plugin, each list sorted by consumer then channel. */
export function consumersByPlugin(doc) {
  const out = {};
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  for (const r of rows) {
    if (!r || typeof r.plugin !== 'string') continue;
    const { plugin, ...rest } = r;
    (out[plugin] ??= []).push(rest);
  }
  const key = (r) => `${r.consumer ?? ''}\u0000${r.channel ?? ''}`;
  for (const list of Object.values(out)) list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return out;
}

/** Date of the CHANGELOG heading for `version` ("## [1.1.1] - 2026-11-08"), or null. */
export function changelogDate(text, version) {
  if (typeof text !== 'string' || !version) return null;
  const esc = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`^##\\s*\\[${esc}\\]\\s*-\\s*(\\d{4}-\\d{2}-\\d{2})`, 'm'));
  return m ? m[1] : null;
}

/** Last release of the current version: its tag's commit date, else the CHANGELOG date. */
export function lastUpdated(version, tagDate, changelogText) {
  if (tagDate) return { date: tagDate, version, source: 'tag' };
  const d = changelogDate(changelogText, version);
  return d ? { date: d, version, source: 'changelog' } : { date: null, version, source: null };
}

/**
 * Score fields for one plugin: the tracked (major/minor) history, the change vs the previous
 * tracked version, and when/what the current scores refer to.
 */
export function scoreFields({ name, version, scores, history = [], latestEntry = null, builtAt }) {
  const own = history.filter((r) => r?.plugin === name && parse(r.version)).sort((a, b) => compare(a.version, b.version));
  const valid = !!(version && parse(version));
  const prevVersion = valid ? lastTrackedVersion(own, name, version) : null;
  const previous = prevVersion ? own.filter((r) => r.version === prevVersion).at(-1) : null;
  const inHistory = own.find((r) => r.version === version) ?? null;
  const recorded = latestEntry?.version === version ? latestEntry : inHistory;
  let tracked;
  let reason = null;
  if (inHistory) tracked = true;
  else if (recorded && typeof recorded.tracked === 'boolean') { tracked = recorded.tracked; reason = recorded.reason ?? null; }
  else if (valid) ({ tracked, reason } = isTracked(version, prevVersion));
  else tracked = false;
  return {
    score_history: own.map((r) => ({ version: r.version, recorded_at: r.recorded_at ?? null, security: r.security ?? null, quality: r.quality ?? null, evals: r.evals?.pass_rate ?? null })),
    score_change: scoreChange(scores, previous),
    scored: { at: recorded?.recorded_at ?? builtAt, version, tracked, reason: tracked ? null : reason, source: recorded ? 'release' : 'build' },
  };
}

// ---------- Markdown → safe HTML (small subset, zero deps) ----------
// Supports headings, paragraphs, lists, fenced/indented code, inline code, links, emphasis,
// tables, blockquotes and rules. Everything else is escaped text: raw HTML never passes through.

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Absolute http(s)/mailto URL for a Markdown link, resolving relative paths against `base`; null if unsafe. */
export function safeUrl(url, base) {
  const raw = String(url ?? '').trim();
  if (!raw || raw.startsWith('#')) return null; // in-page anchors would fight the site's hash routing
  let u;
  try { u = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  return /^(https?|mailto):$/.test(u.protocol) ? u.href : null;
}

const emphasis = (escaped) => escaped
  .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
  .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');

/** Inline Markdown: code spans, [links](url), ![images](url) as links, **bold**, *em*. */
export function renderInline(text, base) {
  const re = /`([^`]+)`|(!?)\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let out = '';
  let last = 0;
  for (const m of String(text).matchAll(re)) {
    out += emphasis(escapeHtml(text.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[1] !== undefined) { out += `<code>${escapeHtml(m[1])}</code>`; continue; }
    const label = m[3].replace(/`([^`]+)`/g, '$1');
    const inner = emphasis(escapeHtml(label));
    const href = safeUrl(m[4], base);
    out += href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>` : inner;
  }
  return out + emphasis(escapeHtml(text.slice(last)));
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isTableSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line ?? '');
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/**
 * Markdown subset → HTML string. `base` resolves relative links (e.g. the plugin's GitHub folder);
 * `headingOffset` shifts heading levels (h1 + 2 → h3, capped at h6); `dropTitle` removes a leading h1.
 */
export function renderMarkdown(md, { base = null, headingOffset = 0, dropTitle = false } = {}) {
  if (typeof md !== 'string' || !md.trim()) return '';
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const inline = (t) => renderInline(t, base);
  let i = 0;
  if (dropTitle) {
    while (i < lines.length && !lines[i].trim()) i++;
    if (/^#\s/.test(lines[i] ?? '')) i++;
  }
  const blockStart = (l) => /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || LIST_RE.test(l) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^\s*(```|~~~)\s*([\w+-]*)/))) {
      const fence = m[1];
      const lang = m[2];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      out.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^( {4}|\t)/.test(line)) {
      const body = [];
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^( {4}|\t)/, ''));
      out.push(`<pre><code>${escapeHtml(body.join('\n').replace(/\n+$/, ''))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const level = Math.min(6, m[1].length + headingOffset);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.includes('|') && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` class="align-${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push('<div class="table-scroll"><table><thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => cell('td', r[k] ?? '', k)).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), { base, headingOffset })}</blockquote>`);
      continue;
    }
    if ((m = line.match(LIST_RE))) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(LIST_RE);
        if (lm && /\d/.test(lm[2]) === ordered) { items.push(lm[3]); i++; continue; }
        if (lm) break;
        // Continuation: an indented (or lazy) line that is not a new block.
        if (lines[i].trim() && items.length && !blockStart(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1]))) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim()); // never stall on an odd line
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** Release timeline: CHANGELOG versions with dates, merged with release tags; newest first. */
export function releaseTimeline(changelogText, tagDates = {}) {
  const map = new Map();
  if (typeof changelogText === 'string') {
    for (const m of changelogText.matchAll(/^##\s*\[([^\]]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?/gm)) {
      if (parse(m[1])) map.set(m[1], { version: m[1], date: m[2] ?? null, tagged: false });
    }
  }
  for (const [v, d] of Object.entries(tagDates ?? {})) {
    if (!parse(v)) continue;
    const r = map.get(v) ?? { version: v, date: null, tagged: false };
    map.set(v, { ...r, date: d ?? r.date, tagged: true });
  }
  return [...map.values()].sort((a, b) => compare(b.version, a.version));
}

/**
 * Daily adoption: for each plugin, the number of distinct consumers with status "active" on
 * every scan date seen in the consumers snapshots (a date with no active rows counts 0).
 */
export function adoptionSeries(rows, names) {
  const dates = [...new Set(rows.map((r) => r?.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')))].sort();
  const active = new Map(); // `${plugin}\0${date}` -> Set(consumer)
  for (const r of rows) {
    if (!r || r.status !== 'active' || typeof r.plugin !== 'string' || !r.date) continue;
    const k = `${r.plugin}\u0000${r.date}`;
    if (!active.has(k)) active.set(k, new Set());
    active.get(k).add(r.consumer ?? r.team ?? '');
  }
  const out = {};
  for (const n of names) out[n] = dates.map((date) => ({ date, active: active.get(`${n}\u0000${date}`)?.size ?? 0 }));
  return out;
}

function readText(root, rel) {
  try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
}

/**
 * Pure: site data from a loadRepo() result plus pre-fetched git data.
 * @param stableVersions {[plugin]: version} from origin/stable, or null when there is no stable branch
 * @param consumersDoc   parsed origin/data:latest/consumers.json, or null
 * @param skillspector   {[plugin]: risk 0–100} from a --skillspector file, or null (not run)
 * @param qualityReports readQualityReports() of a --quality dir, or null (tool-based quality parts not run)
 * @param scoresLatest   parsed origin/data:latest/scores.json, or null
 * @param scoreHistory   records from origin/data:scores/**.ndjson
 * @param tagDates       {[plugin]: YYYY-MM-DD} commit date of the current version's tag
 * @param releaseTags    {[plugin]: {[version]: YYYY-MM-DD}} every release tag's commit date
 * @param consumerHistory rows from origin/data:consumers/**.ndjson (daily snapshots)
 */
export function buildData(repo, {
  stableVersions = null, consumersDoc = null, now = new Date().toISOString(),
  skillspector = null, qualityReports = null, scoresLatest = null, scoreHistory = [], tagDates = {}, releaseTags = {}, consumerHistory = [], evalsResults = readEvalsResults(repo.root),
} = {}) {
  const { catalogues, excluded } = buildCatalogues(repo);
  const listed = new Set(catalogues[0].json.plugins.map((e) => e.name));
  const consumers = consumersByPlugin(consumersDoc);

  const plugins = repo.plugins
    .filter((p) => listed.has(p.dir))
    .map((p) => {
      const skills = p.skills.map((s) => skillMeta(s.skillMd, s.name));
      const changelog = readText(repo.root, `${p.path}/CHANGELOG.md`);
      const base = `https://github.com/${REPO}/blob/main/${p.path}/`;
      return {
        name: p.dir,
        description: p.manifest.description,
        stage: p.status.stage,
        since: p.status.since ?? null,
        category: p.catalogue.category,
        owner: p.catalogue.owner ?? null,
        replaced_by: p.catalogue.replacedBy ?? null,
        languages: [...(p.catalogue.languages ?? [])],
        compatibility: skills.find((s) => s.compatibility)?.compatibility ?? null,
        tags: [...(p.manifest.keywords ?? [])],
        readme_url: `https://github.com/${REPO}/blob/main/${p.path}/README.md`,
        skills: skills.map(({ name, description }) => ({ name, description })),
        versions: { latest: p.manifest.version ?? null, stable: stableVersions?.[p.dir] ?? null },
        last_updated: lastUpdated(p.manifest.version ?? null, tagDates[p.dir] ?? null, changelog),
        releases: releaseTimeline(changelog, releaseTags[p.dir]),
        // Rendered at build time to escaped HTML (no raw HTML passes through); the page inserts it as-is.
        readme_html: renderMarkdown(readText(repo.root, `${p.path}/README.md`), { base, headingOffset: 2, dropTitle: true }),
        changelog_html: renderMarkdown(changelog, { base, headingOffset: 2, dropTitle: true }),
      };
    });
  const byDir = new Map(repo.plugins.map((p) => [p.dir, p]));
  const adoption = adoptionSeries(consumerHistory, plugins.map((p) => p.name));

  // Only show genuinely similar plugins: unrelated pairs score ~0.01, related ones ~0.1+.
  const rel = related(plugins, { top: 3, minScore: RELATED_MIN_SCORE });
  for (const p of plugins) {
    p.related = rel[p.name] ?? [];
    p.consumers = consumers[p.name] ?? [];
    p.adoption_history = adoption[p.name];
    p.scores = scorePlugin({ root: repo.root, repo, plugin: byDir.get(p.name), evalsResults, skillspector, consumers: p.consumers, qualityReports });
    Object.assign(p, scoreFields({
      name: p.name, version: p.versions.latest, scores: p.scores, history: scoreHistory,
      latestEntry: scoresLatest?.plugins?.[p.name] ?? null, builtAt: now,
    }));
  }

  const retired = new Set(repo.plugins.filter((p) => p.status?.stage === 'retired').map((p) => p.dir));
  const sandbox = excluded
    .filter((e) => !retired.has(e.name))
    .map((e) => ({ name: e.name, reasons: e.reasons, path: `plugins/${e.name}` }));

  return {
    generated_at: now,
    repo: REPO,
    pages_url: PAGES_URL,
    channels: CHANNELS.map((c) => ({ id: c.id, name: c.name, ref: c.ref })),
    plugins,
    sandbox,
    consumers_note: CONSUMERS_NOTE,
    // When the insights run last wrote usage data; the site warns when it is over 36 hours old.
    consumers_generated_at: typeof consumersDoc?.generated_at === 'string' ? consumersDoc.generated_at : null,
    skillspector_ran: !!skillspector,
    quality_tools_ran: !!qualityReports,
    scores_explained: { ...SCORES_EXPLAINED, quality_criteria: QUALITY_CRITERIA.map(({ id, label, weight }) => ({ id, label, weight })) },
    // The thresholds the code enforces, so the Scoring and Lifecycle pages quote them exactly.
    rules: {
      security_penalty: SECURITY_PENALTY,
      skillspector_fail_over: 50,
      docs_k: DOCS_K,
      best_practice_rules: BEST_PRACTICE_RULES.map((r) => r.label),
      min_cases: MIN_CASES,
      min_trigger_each: MIN_TRIGGER_EACH,
      stage_next: NEXT,
      min_days: MIN_DAYS,
      min_consumers: MIN_CONSUMERS,
      retire_label: RETIRE_LABEL,
    },
  };
}

/** `git show <ref>:<path>` or null (missing ref/path, or not a git repo). */
export function gitShow(root, ref, path) {
  const r = spawnSync('git', ['-C', root, 'show', `${ref}:${path}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

const parseOrNull = (text) => {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
};

/** Files under a path on a ref (`git ls-tree -r --name-only`), [] when missing. */
export function gitList(root, ref, path) {
  const r = spawnSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', ref, '--', path], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

/** Commit date (YYYY-MM-DD) of a tag, or null. */
export function gitTagDate(root, tag) {
  const r = spawnSync('git', ['-C', root, 'log', '-1', '--format=%cs', `refs/tags/${tag}`], { encoding: 'utf8' });
  const d = r.status === 0 ? r.stdout.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Score history (origin/data:scores/**.ndjson) and latest/scores.json. Injectable for tests. */
export function readScoreData(show, list) {
  const scoreHistory = list('origin/data', 'scores').filter((f) => f.endsWith('.ndjson')).sort()
    .flatMap((f) => parseNdjson(show('origin/data', f)));
  return { scoreHistory, scoresLatest: parseOrNull(show('origin/data', 'latest/scores.json')) };
}

/** Daily consumer snapshots (origin/data:consumers/**.ndjson); [] without a data branch. */
export function readConsumerHistory(show, list) {
  return list('origin/data', 'consumers').filter((f) => f.endsWith('.ndjson')).sort()
    .flatMap((f) => parseNdjson(show('origin/data', f)));
}

/** {[plugin]: {[version]: date}} for every `<plugin>--v<version>` tag. */
export function gitReleaseTags(root, names) {
  const r = spawnSync('git', ['-C', root, 'tag', '-l', '*--v*'], { encoding: 'utf8' });
  const out = {};
  if (r.status !== 0) return out;
  const known = new Set(names);
  for (const tag of r.stdout.split('\n').filter(Boolean)) {
    const m = tag.match(/^(.+)--v(\d+\.\d+\.\d+)$/);
    if (!m || !known.has(m[1])) continue;
    (out[m[1]] ??= {})[m[2]] = gitTagDate(root, tag);
  }
  return out;
}

/** Read origin/stable plugin versions and origin/data consumers. Injectable `show` for tests. */
export function readGitData(repo, show = (ref, path) => gitShow(repo.root, ref, path)) {
  let stableVersions = null;
  if (show('origin/stable', '') !== null) { // `git show origin/stable:` = root tree; fails if no branch
    stableVersions = {};
    for (const p of repo.plugins) {
      const v = parseOrNull(show('origin/stable', `${p.path}/.claude-plugin/plugin.json`))?.version;
      if (typeof v === 'string') stableVersions[p.dir] = v;
    }
  }
  const consumersDoc = parseOrNull(show('origin/data', 'latest/consumers.json'));
  return { stableVersions, consumersDoc };
}

export function main(argv = process.argv.slice(2), log = console.log) {
  let root = process.cwd();
  let out = '_site';
  let skillspectorFile = null;
  let qualityDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--skillspector') skillspectorFile = argv[++i];
    else if (argv[i] === '--quality') qualityDir = argv[++i];
    else { log(`unknown argument: ${argv[i]}`); return 2; }
  }
  root = resolve(root);
  out = resolve(root, out);
  if (root === out || root.startsWith(out + '/')) { log(`refusing to overwrite ${out}: it contains --root`); return 2; }
  const repo = loadRepo(root);
  const git = readGitData(repo);
  const scoreData = readScoreData((ref, path) => gitShow(root, ref, path), (ref, path) => gitList(root, ref, path));
  const releaseTags = gitReleaseTags(root, repo.plugins.map((p) => p.dir));
  const tagDates = {};
  for (const p of repo.plugins) {
    const d = p.manifest?.version ? releaseTags[p.dir]?.[p.manifest.version] ?? null : null;
    if (d) tagDates[p.dir] = d;
  }
  const consumerHistory = readConsumerHistory((ref, path) => gitShow(root, ref, path), (ref, path) => gitList(root, ref, path));
  // A missing or unreadable SkillSpector file means "not run", never a failed build.
  const skillspector = skillspectorFile ? readSkillspector(resolve(root, skillspectorFile)) : null;
  // Likewise a missing quality-tools directory: those quality parts show "not run".
  const qualityReports = qualityDir ? readQualityReports(resolve(root, qualityDir)) : null;
  const data = buildData(repo, { ...git, ...scoreData, tagDates, releaseTags, consumerHistory, skillspector, qualityReports });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'site'), out, { recursive: true });
  writeFileSync(join(out, 'data.json'), stableJson(data));
  log(`build-site: ${data.plugins.length} listed, ${data.sandbox.length} sandbox; ` +
    `stable branch ${git.stableVersions ? 'found' : 'missing'}; consumers ${git.consumersDoc ? 'found' : 'missing'}; ` +
    `score history ${scoreData.scoreHistory.length} record(s); consumer snapshots ${consumerHistory.length} row(s); SkillSpector ${skillspector ? 'used' : 'not run'}; quality tools ${qualityReports ? 'used' : 'not run'} → ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
