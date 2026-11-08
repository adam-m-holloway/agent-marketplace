// Helpers shared by check rules. Files starting with "_" are not rules.
import { readFileSync, existsSync } from 'node:fs';
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

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
