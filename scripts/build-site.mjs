#!/usr/bin/env node
// Build the GitHub Pages catalogue: copy site/ into --out and write data.json.
// Usage: node scripts/build-site.mjs [--root .] [--out _site] [--skillspector skillspector.json]
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
  readSkillspector, scoreChange, scorePlugin,
} from './scores.mjs';

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
  const esc = version.replace(/\./g, '\\.');
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

function readText(root, rel) {
  try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
}

/**
 * Pure: site data from a loadRepo() result plus pre-fetched git data.
 * @param stableVersions {[plugin]: version} from origin/stable, or null when there is no stable branch
 * @param consumersDoc   parsed origin/data:latest/consumers.json, or null
 * @param skillspector   {[plugin]: risk 0–100} from a --skillspector file, or null (not run)
 * @param scoresLatest   parsed origin/data:latest/scores.json, or null
 * @param scoreHistory   records from origin/data:scores/**.ndjson
 * @param tagDates       {[plugin]: YYYY-MM-DD} commit date of the current version's tag
 */
export function buildData(repo, {
  stableVersions = null, consumersDoc = null, now = new Date().toISOString(),
  skillspector = null, scoresLatest = null, scoreHistory = [], tagDates = {}, evalsResults = readEvalsResults(repo.root),
} = {}) {
  const { catalogues, excluded } = buildCatalogues(repo);
  const listed = new Set(catalogues[0].json.plugins.map((e) => e.name));
  const consumers = consumersByPlugin(consumersDoc);

  const plugins = repo.plugins
    .filter((p) => listed.has(p.dir))
    .map((p) => {
      const skills = p.skills.map((s) => skillMeta(s.skillMd, s.name));
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
        last_updated: lastUpdated(p.manifest.version ?? null, tagDates[p.dir] ?? null, readText(repo.root, `${p.path}/CHANGELOG.md`)),
      };
    });
  const byDir = new Map(repo.plugins.map((p) => [p.dir, p]));

  // Only show genuinely similar plugins: unrelated pairs score ~0.01, related ones ~0.1+.
  const rel = related(plugins, { top: 3, minScore: RELATED_MIN_SCORE });
  for (const p of plugins) {
    p.related = rel[p.name] ?? [];
    p.consumers = consumers[p.name] ?? [];
    p.scores = scorePlugin({ root: repo.root, repo, plugin: byDir.get(p.name), evalsResults, skillspector, consumers: p.consumers });
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
    scores_explained: { ...SCORES_EXPLAINED, quality_criteria: QUALITY_CRITERIA.map(({ id, label, weight }) => ({ id, label, weight })) },
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--skillspector') skillspectorFile = argv[++i];
    else { log(`unknown argument: ${argv[i]}`); return 2; }
  }
  root = resolve(root);
  out = resolve(root, out);
  if (root === out || root.startsWith(out + '/')) { log(`refusing to overwrite ${out}: it contains --root`); return 2; }
  const repo = loadRepo(root);
  const git = readGitData(repo);
  const scoreData = readScoreData((ref, path) => gitShow(root, ref, path), (ref, path) => gitList(root, ref, path));
  const tagDates = {};
  for (const p of repo.plugins) {
    const d = p.manifest?.version ? gitTagDate(root, `${p.dir}--v${p.manifest.version}`) : null;
    if (d) tagDates[p.dir] = d;
  }
  // A missing or unreadable SkillSpector file means "not run", never a failed build.
  const skillspector = skillspectorFile ? readSkillspector(resolve(root, skillspectorFile)) : null;
  const data = buildData(repo, { ...git, ...scoreData, tagDates, skillspector });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'site'), out, { recursive: true });
  writeFileSync(join(out, 'data.json'), stableJson(data));
  log(`build-site: ${data.plugins.length} listed, ${data.sandbox.length} sandbox; ` +
    `stable branch ${git.stableVersions ? 'found' : 'missing'}; consumers ${git.consumersDoc ? 'found' : 'missing'}; ` +
    `score history ${scoreData.scoreHistory.length} record(s); SkillSpector ${skillspector ? 'used' : 'not run'} → ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
