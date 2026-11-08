#!/usr/bin/env node
// Generate the channel catalogues from plugins/.
// Usage: node scripts/sync.mjs [--root <dir>] [--check]
//   --check  write nothing; exit 1 and list stale files (CI uses this).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepo, stableJson } from './lib/plugins.mjs';
import { buildCatalogues } from './lib/catalogue.mjs';

/** Generated files: [{ file, content }] for the tree at root, plus exclusions. */
export function generate(root) {
  const { catalogues, excluded } = buildCatalogues(loadRepo(root));
  return { outputs: catalogues.map((c) => ({ file: c.file, content: stableJson(c.json), count: c.json.plugins.length })), excluded };
}

/** Repo-relative paths of catalogue files that are missing or differ from what sync would write. */
export function staleFiles(root) {
  return generate(root).outputs
    .filter(({ file, content }) => {
      const abs = join(root, file);
      return !existsSync(abs) || readFileSync(abs, 'utf8') !== content;
    })
    .map((o) => o.file);
}

export function main(argv = process.argv.slice(2), log = console.log) {
  let root = process.cwd();
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--check') check = true;
    else { log(`unknown argument: ${argv[i]}`); return 2; }
  }
  root = resolve(root);
  const { outputs, excluded } = generate(root);
  for (const e of excluded) log(`excluded ${e.name}: ${e.reasons.join('; ')}`);

  if (check) {
    const stale = staleFiles(root);
    for (const f of stale) log(`stale ${f} (run npm run sync)`);
    log(stale.length ? `sync --check: ${stale.length} stale file(s)` : 'sync --check: catalogues up to date');
    return stale.length ? 1 : 0;
  }
  for (const { file, content, count } of outputs) {
    const abs = join(root, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    log(`wrote ${file} (${count} plugin${count === 1 ? '' : 's'})`);
  }
  log(`sync: ${outputs[0]?.count ?? 0} listed, ${excluded.length} excluded`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
