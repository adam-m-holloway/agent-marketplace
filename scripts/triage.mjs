#!/usr/bin/env node
// Submission triage (Q29 items 1–2), data only: for each plugin a PR touches, the most similar
// existing plugins and a capability diff (hooks, .mcp.json servers, allowed-tools, bin/, URLs,
// pipe-to-shell lines) against the base branch.
//   node scripts/triage.mjs --root <pr tree> --base <base tree>
// Informational: prints to the log (and the step summary in CI) and ALWAYS exits 0. It reads the
// PR tree as data and never runs anything from it. The PR commenter is a later step.
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRepo } from './lib/plugins.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { docsFromRepo, similarTo } from './similar.mjs';
import { changedPluginDirs } from './check.mjs';

const PATTERNS = fileURLToPath(new URL('../rules/patterns.json', import.meta.url));
const MAX_BYTES = 1_000_000;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/g;
export const CAPABILITIES = {
  hooks: 'Hooks', mcpServers: 'MCP servers', allowedTools: 'allowed-tools', bin: 'bin/', urls: 'URLs', pipeToShell: 'Pipe-to-shell',
};

const uniqSorted = (xs) => [...new Set(xs)].sort();
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function readText(abs) {
  try {
    if (statSync(abs).size > MAX_BYTES) return null;
    return readFileSync(abs, 'utf8');
  } catch { return null; }
}
function readJsonQuiet(abs) {
  const t = readText(abs);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

let pipeRule;
function pipeToShellRe() {
  if (pipeRule === undefined) {
    const r = readJsonQuiet(PATTERNS)?.rules?.find((x) => x.id === 'pipe-to-shell');
    pipeRule = r ? new RegExp(r.pattern, r.flags ?? '') : null;
  }
  return pipeRule;
}

const hookEvents = (h) => (isObj(h) ? Object.keys(isObj(h.hooks) ? h.hooks : h) : []);
const mcpNames = (m) => (isObj(m) ? Object.keys(isObj(m.mcpServers) ? m.mcpServers : m) : []);
function toolList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string') return [];
  return v.split(v.includes(',') ? ',' : /\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Capabilities of one loadPlugin() result, read from the tree at `root`. Paths are plugin-relative. */
export function capabilities(p, root) {
  const abs = join(root, p.path);
  const rel = (f) => f.slice(p.path.length + 1);
  const files = p.files.map(rel);
  const hooks = [...hookEvents(readJsonQuiet(join(abs, 'hooks/hooks.json')))];
  if (isObj(p.manifest?.hooks)) hooks.push(...hookEvents(p.manifest.hooks));
  const mcp = [...mcpNames(readJsonQuiet(join(abs, '.mcp.json')))];
  if (isObj(p.manifest?.mcpServers)) mcp.push(...mcpNames(p.manifest.mcpServers));
  const tools = [];
  const urls = [];
  const pipes = [];
  const re = pipeToShellRe();
  for (const f of files) {
    const text = readText(join(abs, f));
    if (text == null || text.includes('\u0000')) continue;
    if (f.endsWith('.md')) tools.push(...toolList(parseFrontmatter(text).data?.['allowed-tools']));
    for (const m of text.matchAll(URL_RE)) urls.push(m[0].replace(/[.,;:!?]+$/, ''));
    if (re) text.split('\n').forEach((line, i) => { if (re.test(line)) pipes.push(`${f}:${i + 1}`); });
  }
  return {
    hooks: uniqSorted(hooks),
    mcpServers: uniqSorted(mcp),
    allowedTools: uniqSorted(tools),
    bin: files.filter((f) => f.startsWith('bin/')).sort(),
    urls: uniqSorted(urls),
    pipeToShell: uniqSorted(pipes),
  };
}

const EMPTY = Object.fromEntries(Object.keys(CAPABILITIES).map((k) => [k, []]));

/**
 * @param prPluginDirs plugin folder names the PR touches
 * @param repo loadRepo(pr tree)
 * @param opts.baseRepo loadRepo(base tree) — similarity is against the base's plugins; the diff is base → PR
 * @returns [{plugin, removed:true} | {plugin, isNew, similar:[{name,score}], diff:{[cap]:{added,removed}}}]
 */
export function triage(prPluginDirs, repo, { baseRepo = null } = {}) {
  const pool = docsFromRepo(baseRepo ?? repo);
  const prDocs = new Map(docsFromRepo(repo).map((d) => [d.name, d]));
  return [...prPluginDirs].sort().map((dir) => {
    const p = repo.plugins.find((x) => x.dir === dir);
    if (!p) return { plugin: dir, removed: true };
    const b = baseRepo?.plugins.find((x) => x.dir === dir) ?? null;
    const now = capabilities(p, repo.root);
    const before = b ? capabilities(b, baseRepo.root) : EMPTY;
    const diff = {};
    for (const k of Object.keys(CAPABILITIES)) {
      diff[k] = { added: now[k].filter((x) => !before[k].includes(x)), removed: before[k].filter((x) => !now[k].includes(x)) };
    }
    return { plugin: dir, isNew: !b, similar: similarTo(prDocs.get(dir), pool), diff };
  });
}

export function renderTriage(results) {
  if (!results.length) return 'Triage: no plugin changes in this PR.\n';
  const out = [];
  for (const r of results) {
    if (r.removed) { out.push(`## Triage: ${r.plugin} (removed)`, ''); continue; }
    out.push(`## Triage: ${r.plugin} (${r.isNew ? 'new plugin' : 'changed'})`, '');
    out.push(r.similar.length
      ? `Similar existing plugins: ${r.similar.map((s) => `${s.name} (score ${s.score.toFixed(3)})`).join(', ')}`
      : 'Similar existing plugins: none');
    const changes = Object.entries(CAPABILITIES)
      .map(([k, label]) => [label, r.diff[k]])
      .filter(([, d]) => d.added.length || d.removed.length)
      .map(([label, d]) => `- ${label}: ${[...d.added.map((x) => `+${x}`), ...d.removed.map((x) => `-${x}`)].join(', ')}`);
    out.push('', changes.length ? 'Capability changes:' : 'Capability changes: none', ...changes, '');
  }
  return out.join('\n');
}

export function main(argv) {
  let root = '.';
  let base = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--base') base = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]} (usage: --root <pr> --base <base>)`);
  }
  if (!base) throw new Error('--base is required');
  root = resolve(root);
  base = resolve(base);
  const text = renderTriage(triage(changedPluginDirs(base, root), loadRepo(root), { baseRepo: loadRepo(base) }));
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.log(`triage skipped: ${e.message}`); }
  process.exitCode = 0;
}
