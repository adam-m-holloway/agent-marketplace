// Helpers shared by check rules. Files starting with "_" are not rules.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Repo that holds these scripts (in CI: ./base) — schemas and patterns come from here, never from the PR. */
export const SCRIPTS_ROOT = new URL('../../../', import.meta.url);

export function f(rule, severity, file, message, line) {
  return line ? { rule, severity, file, line, message } : { rule, severity, file, message };
}

export async function tryImport(relUrl) {
  try {
    return await import(new URL(relUrl, import.meta.url));
  } catch {
    return null;
  }
}

/** Lazily load scripts/lib/schema.mjs; null when not available. */
export async function loadValidator() {
  const m = await tryImport('../schema.mjs');
  return typeof m?.validate === 'function' ? m.validate : null;
}

export function skipped(rule, lib) {
  return f(rule, 'MEDIUM', lib, `rule skipped: ${lib} not available`);
}

export function loadOwnJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, SCRIPTS_ROOT), 'utf8'));
}

export function readText(root, rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** A plugin file's text, or null when it is binary (contains a NUL byte). Shared by the scanners. */
export function readPluginText(root, rel) {
  const buf = readFileSync(join(root, rel));
  return buf.includes(0) ? null : buf.toString('utf8');
}

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);
function walkTree(dir, rel = '') {
  let ents;
  try { ents = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && r !== '.claude/worktrees') out.push(...walkTree(dir, r));
    } else if (!SKIP_DIRS.has(e.name)) out.push(r); // a worktree's .git is a file
  }
  return out;
}

/** Repo-relative files added, removed or modified between two trees (under `sub` when given). Sorted. */
export function diffFiles(baseRoot, root, sub = '') {
  const a = new Set(walkTree(baseRoot, sub));
  const b = new Set(walkTree(root, sub));
  return [...new Set([...a, ...b])].sort().filter((p) =>
    !a.has(p) || !b.has(p) || !readFileSync(join(baseRoot, p)).equals(readFileSync(join(root, p))));
}
