#!/usr/bin/env node
// Every `uses:` in a workflow must be pinned to a full 40-hex commit SHA.
// Local actions (`./…`) are allowed; docker images must be pinned by sha256 digest.
// Usage: node scripts/check-actions-pinned.mjs <workflows-dir> [...more dirs or files]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const USES = /^\s*(?:-\s+)?uses:\s*(['"]?)([^'"\s#]+)\1/;
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const DOCKER_PINNED = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

/** @returns {{rule:string, severity:'ERROR', file:string, line:number, message:string}[]} */
export function checkWorkflowText(text, file) {
  const findings = [];
  String(text).split('\n').forEach((raw, i) => {
    const m = USES.exec(raw);
    if (!m) return;
    const ref = m[2];
    if (ref.startsWith('./')) return;
    if (ref.startsWith('docker://') ? DOCKER_PINNED.test(ref) : PINNED.test(ref)) return;
    findings.push({
      rule: 'actions-pinned',
      severity: 'ERROR',
      file,
      line: i + 1,
      message: `\`uses: ${ref}\` is not pinned to a full commit SHA (use owner/repo@<40-hex> # vX.Y.Z)`,
    });
  });
  return findings;
}

function workflowFiles(p) {
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => join(p, f));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('usage: check-actions-pinned.mjs <workflows-dir> [...]');
    process.exit(2);
  }
  const files = targets.flatMap(workflowFiles);
  const findings = files.flatMap((f) => checkWorkflowText(readFileSync(f, 'utf8'), f));
  for (const f of findings) {
    console.log(`::error file=${f.file},line=${f.line}::${f.message}`);
  }
  console.log(`check-actions-pinned: ${files.length} file(s), ${findings.length} unpinned action(s)`);
  process.exit(findings.length ? 1 : 0);
}
