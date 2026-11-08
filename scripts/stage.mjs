#!/usr/bin/env node
// npm run stage <plugin> <stage> [-- --reason <text>] [--consumers <consumers.json>] [--root <dir>] [--today YYYY-MM-DD]
// Moves a plugin one stage (status.json stage + since = today), runs sync, and prints the readiness
// checklist the stage-gate PR check will apply (same functions). Exit 1 when a gate fails.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadPlugin, stableJson, STAGES } from './lib/plugins.mjs';
import { gateChecks, NEXT, todayIso } from './lib/rules/stage-gate.mjs';
import { main as sync } from './sync.mjs';

/**
 * @returns {{from:string, to:string, items:{gate:string, ok:boolean, message:string}[], ready:boolean}}
 * Throws (writing nothing) on an unknown plugin/stage or a move that is not one legal step.
 */
export function stage(root, name, to, { reason, consumers = null, today = todayIso(), log = console.log } = {}) {
  if (!STAGES.includes(to)) throw new Error(`unknown stage "${to}" (one of ${STAGES.join(', ')})`);
  const file = join(root, 'plugins', name, 'status.json');
  if (!existsSync(file)) throw new Error(`plugins/${name}/status.json not found`);
  const old = JSON.parse(readFileSync(file, 'utf8'));
  const from = old.stage;
  if (!(NEXT[from] ?? []).includes(to)) {
    throw new Error(`${from} → ${to} is not allowed — one step at a time (${from} → ${(NEXT[from] ?? []).join(' | ') || 'nothing'})`);
  }
  writeFileSync(file, stableJson({ ...old, stage: to, since: today, ...(reason ? { reason } : {}) }));
  sync(['--root', root], () => {});
  const items = gateChecks({ root, plugin: loadPlugin(root, name), fromStatus: old, to, consumers, today });
  const ready = items.every((x) => x.ok);
  log(`plugins/${name}: ${from} → ${to} (since ${today}); catalogues synced`);
  for (const x of items) log(`${x.ok ? 'PASS' : 'FAIL'} ${x.gate}: ${x.message}`);
  log(ready
    ? 'READY — commit status.json + catalogues and open the PR for review'
    : 'NOT READY — the stage-gate PR check will fail until every FAIL above passes');
  return { from, to, items, ready };
}

function main() {
  let o;
  try {
    o = parseArgs({
      allowPositionals: true,
      options: { root: { type: 'string' }, reason: { type: 'string' }, consumers: { type: 'string' }, today: { type: 'string' } },
    });
    if (o.positionals.length !== 2) throw new Error('usage: npm run stage <plugin> <stage> [-- --reason <text>] [--consumers <file>]');
    const [name, to] = o.positionals;
    const consumers = o.values.consumers ? JSON.parse(readFileSync(o.values.consumers, 'utf8')) : null;
    const r = stage(resolve(o.values.root ?? process.cwd()), name, to, { reason: o.values.reason, consumers, today: o.values.today });
    return r.ready ? 0 : 1;
  } catch (e) {
    console.error(`stage: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
