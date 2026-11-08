#!/usr/bin/env node
// npm run promote [<main-sha>] [--dry-run] [--no-fetch] [--date YYYY-MM-DD]
// Cuts promote/<date>-<short> from origin/stable, sets its tree to exactly main@sha (read-tree),
// commits "chore(stable): promote main@<short>" and (unless --dry-run) pushes + opens a PR to stable.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compare } from './lib/semver.mjs';
import { today } from './new-plugin.mjs';

const short = (sha) => sha.slice(0, 7);

export const promotionTitle = (sha) => `chore(stable): promote main@${short(sha)}`;
export const branchName = (sha, date) => `promote/${date}-${short(sha)}`;

/**
 * @param {Record<string,string>} stablePlugins name -> version on stable
 * @param {Record<string,string>} mainPlugins   name -> version at main@sha
 * @returns {{name:string, from:string|null, to:string|null, change:'added'|'removed'|'up'|'down'|'same'}[]}
 */
export function versionChanges(stablePlugins, mainPlugins) {
  const names = [...new Set([...Object.keys(stablePlugins), ...Object.keys(mainPlugins)])].sort();
  return names.map((name) => {
    const from = stablePlugins[name] ?? null;
    const to = mainPlugins[name] ?? null;
    let change;
    if (from === null) change = 'added';
    else if (to === null) change = 'removed';
    else change = ['down', 'same', 'up'][compare(to, from) + 1];
    return { name, from, to, change };
  });
}

export const isRollback = (changes) => changes.some((c) => c.change === 'down');

export function promotionBody(changes) {
  const lines = ['Plugin versions (stable → main):', ''];
  for (const c of changes) {
    const note = c.change === 'down' ? ' (rollback)' : c.change === 'same' ? ' (unchanged)' : '';
    lines.push(`- ${c.name}: ${c.from ?? 'new'} → ${c.to ?? 'removed'}${note}`);
  }
  if (!changes.length) lines.push('- (no plugins)');
  if (isRollback(changes)) lines.push('', 'rollback: add the rollback label');
  return lines.join('\n') + '\n';
}

function run(cwd, args, opts = {}) {
  return execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}
const git = (cwd, ...args) => run(cwd, ['git', ...args]);

/** name -> version for every plugins/<dir>/.claude-plugin/plugin.json at `ref`. */
export function pluginVersionsAt(cwd, ref) {
  let dirs;
  try {
    dirs = git(cwd, 'ls-tree', '--name-only', `${ref}:plugins`).split('\n').filter(Boolean);
  } catch {
    return {};
  }
  const out = {};
  for (const d of dirs) {
    try {
      const m = JSON.parse(git(cwd, 'show', `${ref}:plugins/${d}/.claude-plugin/plugin.json`));
      out[m.name ?? d] = m.version;
    } catch { /* not a plugin folder */ }
  }
  return out;
}

export function promote({ cwd = process.cwd(), sha, dryRun = false, fetch = true, date = today(), log = console.log }) {
  if (git(cwd, 'status', '--porcelain')) throw new Error('working tree is not clean; commit or stash first');
  if (fetch) git(cwd, 'fetch', 'origin', 'main', 'stable');
  const full = git(cwd, 'rev-parse', '--verify', `${sha ?? 'origin/main'}^{commit}`);
  const stable = git(cwd, 'rev-parse', '--verify', 'origin/stable^{commit}');
  if (git(cwd, 'rev-parse', `${full}^{tree}`) === git(cwd, 'rev-parse', `${stable}^{tree}`)) {
    throw new Error(`stable already matches main@${short(full)}; nothing to promote`);
  }
  const changes = versionChanges(pluginVersionsAt(cwd, stable), pluginVersionsAt(cwd, full));
  const title = promotionTitle(full);
  const body = promotionBody(changes);
  const branch = branchName(full, date);

  const original = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', branch, stable);
  try {
    git(cwd, 'read-tree', '-u', '--reset', full);
    git(cwd, 'commit', '-q', '--no-verify', '-m', title, '-m', body);
  } finally {
    // leave the user where they started; the promote branch keeps the commit
    git(cwd, 'checkout', '-q', '-f', original === 'HEAD' ? stable : original);
  }
  log(`${branch}: ${title}\n\n${body}`);
  if (dryRun) {
    log('dry run: not pushing or opening a PR');
    return { branch, title, body, changes };
  }
  git(cwd, 'push', '-u', 'origin', branch);
  const url = run(cwd, ['gh', 'pr', 'create', '--base', 'stable', '--head', branch, '--title', title, '--body', body]);
  log(url);
  return { branch, title, body, changes, url };
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      'no-fetch': { type: 'boolean', default: false },
      date: { type: 'string' },
    },
  });
  try {
    promote({ sha: positionals[0], dryRun: values['dry-run'], fetch: !values['no-fetch'], date: values.date ?? today() });
  } catch (e) {
    console.error(`promote: ${(e.stderr?.toString().trim() || e.message)}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
