#!/usr/bin/env node
// Insights CLI (used by .github/workflows/insights.yml):
//   node scripts/insights/run.mjs --data <dir of checked-out data branch> [--today YYYY-MM-DD]
// Writes the data branch layout; events are diffed against the latest snapshot BEFORE today,
// so a same-day re-run rewrites identical files.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { scan, diffEvents } from './scan.mjs';
import { renderCatalogueMd, renderSummary } from './report.mjs';
import { CHANNELS, REPO } from '../lib/plugins.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ndjson = (items) => items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '');
const readNdjson = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const partition = (kind, day) => join(kind, `year=${day.slice(0, 4)}`, `month=${day.slice(5, 7)}`);

/** Latest consumers/year=*\/month=*\/<day>.ndjson with day < today, or null. */
export function findPrevious(dataDir, today) {
  const base = join(dataDir, 'consumers');
  if (!existsSync(base)) return null;
  let best = null;
  for (const y of readdirSync(base).filter((d) => d.startsWith('year='))) {
    for (const m of readdirSync(join(base, y)).filter((d) => d.startsWith('month='))) {
      for (const f of readdirSync(join(base, y, m))) {
        const day = f.replace(/\.ndjson$/, '');
        if (f.endsWith('.ndjson') && DAY_RE.test(day) && day < today && (!best || day > best.day)) {
          best = { day, file: join(base, y, m, f) };
        }
      }
    }
  }
  return best;
}

function write(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

export async function run({ dataDir, today, fetch, token, consumers, summaryFile, now = new Date().toISOString() }) {
  if (!DAY_RE.test(today)) throw new Error(`--today must be YYYY-MM-DD, got ${today}`);
  consumers ??= JSON.parse(readFileSync(join(ROOT, 'insights/consumers.json'), 'utf8')).consumers;
  const prevSnap = findPrevious(dataDir, today);
  const previous = prevSnap ? readNdjson(prevSnap.file) : [];

  const { rows, health } = await scan({ consumers, marketplaceRepo: REPO, channels: CHANNELS, fetch, token, today, previous });
  const events = diffEvents(previous, rows);

  // Keep generated_at when a same-day re-run finds the same rows, so files stay byte-identical.
  const latestFile = join(dataDir, 'latest/consumers.json');
  let generatedAt = now;
  if (existsSync(latestFile)) {
    try {
      const old = JSON.parse(readFileSync(latestFile, 'utf8'));
      if (old.scan_date === today && isDeepStrictEqual(old.rows, rows)) generatedAt = old.generated_at;
    } catch { /* rewrite */ }
  }

  write(join(dataDir, partition('consumers', today), `${today}.ndjson`), ndjson(rows));
  write(join(dataDir, partition('events', today), `${today}.ndjson`), ndjson(events));
  write(latestFile, JSON.stringify({ generated_at: generatedAt, scan_date: today, rows }, null, 2) + '\n');
  write(join(dataDir, 'CATALOGUE.md'), renderCatalogueMd(rows, { generatedAt }));
  mkdirSync(join(dataDir, 'schema'), { recursive: true });
  for (const s of ['consumers.schema.json', 'events.schema.json']) copyFileSync(join(ROOT, 'schema', s), join(dataDir, 'schema', s));

  const summary = renderSummary(rows, health) + `\nEvents vs ${prevSnap ? prevSnap.day : '(no previous snapshot)'}: ${events.length ? events.map((e) => `${e.type} ${e.plugin} (${e.team}, ${e.channel})`).join('; ') : 'none'}.\n`;
  if (summaryFile) appendFileSync(summaryFile, summary + '\n');
  return { rows, events, health, previousDay: prevSnap?.day ?? null, summary };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data') args.data = argv[++i];
    else if (argv[i] === '--today') args.today = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.data) throw new Error('usage: node scripts/insights/run.mjs --data <dir> [--today YYYY-MM-DD]');
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await run({
      dataDir: resolve(args.data),
      today: args.today ?? new Date().toISOString().slice(0, 10),
      fetch: globalThis.fetch,
      token: process.env.GITHUB_TOKEN,
      summaryFile: process.env.GITHUB_STEP_SUMMARY,
    });
    process.stdout.write(result.summary);
    for (const h of result.health.filter((x) => x.result === 'unknown')) {
      console.log(`::warning::insights scan of ${h.consumer} failed${h.http === 401 ? ' (token invalid or expired)' : ''}: ${h.note}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
