#!/usr/bin/env node
// Build the GitHub Pages catalogue: copy site/ into --out and write data.json.
// Usage: node scripts/build-site.mjs [--root .] [--out _site]
// Git reads (origin/stable, origin/data) are optional: a missing branch gives null / [].
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHANNELS, REPO, loadRepo, stableJson } from './lib/plugins.mjs';
import { buildCatalogues } from './lib/catalogue.mjs';
import { related } from './similar.mjs';

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

/**
 * Pure: site data from a loadRepo() result plus pre-fetched git data.
 * @param stableVersions {[plugin]: version} from origin/stable, or null when there is no stable branch
 * @param consumersDoc   parsed origin/data:latest/consumers.json, or null
 */
export function buildData(repo, { stableVersions = null, consumersDoc = null, now = new Date().toISOString() } = {}) {
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
      };
    });

  const rel = related(plugins, { top: 3 });
  for (const p of plugins) {
    p.related = rel[p.name] ?? [];
    p.consumers = consumers[p.name] ?? [];
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
    else { log(`unknown argument: ${argv[i]}`); return 2; }
  }
  root = resolve(root);
  out = resolve(root, out);
  if (root === out || root.startsWith(out + '/')) { log(`refusing to overwrite ${out}: it contains --root`); return 2; }
  const repo = loadRepo(root);
  const git = readGitData(repo);
  const data = buildData(repo, git);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'site'), out, { recursive: true });
  writeFileSync(join(out, 'data.json'), stableJson(data));
  log(`build-site: ${data.plugins.length} listed, ${data.sandbox.length} sandbox; ` +
    `stable branch ${git.stableVersions ? 'found' : 'missing'}; consumers ${git.consumersDoc ? 'found' : 'missing'} → ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
