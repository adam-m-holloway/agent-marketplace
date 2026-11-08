// Shared loader for the marketplace repo. Zero dependencies.
// Contract: every script reads the repo through loadRepo(); nothing else walks plugins/.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const OWNER = { name: 'Adam Holloway' };
export const REPO = 'adam-m-holloway/agent-marketplace';

/** The two release channels (Slice 0: sibling catalogue files, same plugin sources). */
export const CHANNELS = [
  {
    id: 'latest',
    name: 'agent-marketplace',
    file: '.claude-plugin/marketplace.json',
    ref: 'main',
    description: 'Claude Code plugins for our teams — latest channel (tracks main)',
  },
  {
    id: 'stable',
    name: 'agent-marketplace-stable',
    file: '.claude-plugin/marketplace-stable.json',
    ref: 'stable',
    description: 'Claude Code plugins for our teams — stable channel (reviewed promotions of main)',
  },
];

export const STAGES = ['sandbox', 'incubating', 'published', 'deprecated', 'retired'];
export const LISTED_STAGES = ['incubating', 'published', 'deprecated'];
export const RESERVED_PREFIXES = ['claude-', 'anthropic-', 'cc-plugin-'];
export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Read + parse JSON. Returns { value } or { error } — never throws. */
export function readJson(file) {
  try {
    return { value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: existsSync(file) ? `invalid JSON: ${e.message}` : 'missing' };
  }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** All files under dir (relative POSIX paths), sorted, skipping .git and node_modules. */
export function walk(dir, base = dir) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out.sort();
}

/**
 * Load one plugin folder.
 * @returns {{
 *   dir: string, name: string, path: string,          // folder name, repo-relative path "plugins/<dir>"
 *   manifest: object|null, catalogue: object|null, status: object|null,
 *   loadErrors: {file:string, message:string}[],       // missing/invalid JSON only; rules do the rest
 *   skills: {name:string, path:string, skillMd:string|null, evals:object|null, triggerEvals:any[]|null,
 *            evalsError?:string, triggerEvalsError?:string}[],
 *   files: string[]                                    // repo-relative paths of every file in the plugin
 * }}
 */
export function loadPlugin(root, dir) {
  const path = `plugins/${dir}`;
  const abs = join(root, path);
  const loadErrors = [];
  const load = (rel) => {
    const r = readJson(join(abs, rel));
    if (r.error) loadErrors.push({ file: `${path}/${rel}`, message: r.error });
    return r.value ?? null;
  };
  const manifest = load('.claude-plugin/plugin.json');
  const catalogue = load('catalogue.json');
  const status = load('status.json');
  const skills = [];
  const skillsDir = join(abs, 'skills');
  if (isDir(skillsDir)) {
    for (const s of readdirSync(skillsDir).sort()) {
      const sAbs = join(skillsDir, s);
      if (!isDir(sAbs)) continue;
      const mdFile = join(sAbs, 'SKILL.md');
      const ev = readJson(join(sAbs, 'evals', 'evals.json'));
      const tr = readJson(join(sAbs, 'evals', 'trigger-evals.json'));
      skills.push({
        name: s,
        path: `${path}/skills/${s}`,
        skillMd: existsSync(mdFile) ? readFileSync(mdFile, 'utf8') : null,
        evals: ev.value ?? null,
        triggerEvals: tr.value ?? null,
        ...(ev.error ? { evalsError: ev.error } : {}),
        ...(tr.error ? { triggerEvalsError: tr.error } : {}),
      });
    }
  }
  const files = walk(abs).map((f) => `${path}/${f}`);
  return { dir, name: manifest?.name ?? dir, path, manifest, catalogue, status, loadErrors, skills, files };
}

/** Load the whole repo rooted at `root`. Plugins sorted by folder name (determinism). */
export function loadRepo(root) {
  const taxonomy = readJson(join(root, 'taxonomy.json')).value ?? { categories: [], tags: [], languages: [] };
  const pluginsDir = join(root, 'plugins');
  const dirs = isDir(pluginsDir) ? readdirSync(pluginsDir).filter((d) => isDir(join(pluginsDir, d))).sort() : [];
  return { root, taxonomy, plugins: dirs.map((d) => loadPlugin(root, d)) };
}

/** Stable JSON for generated files: 2-space indent + trailing newline. */
export function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}
