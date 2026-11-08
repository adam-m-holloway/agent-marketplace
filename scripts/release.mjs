#!/usr/bin/env node
// Tag and release every plugin whose `<name>--v<version>` tag does not exist yet.
// Runs in release.yml on push to main, after `npm test`. Idempotent: a no-bump merge tags nothing.
// Usage: node scripts/release.mjs [--dry-run]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadRepo } from './lib/plugins.mjs';
import { isValid } from './lib/semver.mjs';
import { getSection } from './lib/changelog.mjs';

/**
 * Pure planning step (reads only the repo tree).
 * @param {{root:string, plugins:object[]}} repo  from loadRepo()
 * @param {Iterable<string>} existingTags
 * @returns {{plugin:string, dir:string, version:string, tag:string, notes:string}[]}
 */
export function planReleases(repo, existingTags) {
  const tags = new Set(existingTags);
  const plan = [];
  for (const p of repo.plugins) {
    const name = p.manifest?.name;
    const version = p.manifest?.version;
    if (!name || !isValid(version)) continue;
    const tag = `${name}--v${version}`;
    if (tags.has(tag)) continue;
    let changelog = '';
    try { changelog = readFileSync(join(repo.root, p.path, 'CHANGELOG.md'), 'utf8'); } catch { /* none */ }
    const notes = getSection(changelog, version) || `No CHANGELOG entry found for ${version}.`;
    plan.push({ plugin: name, dir: p.dir, version, tag, notes });
  }
  return plan;
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const existing = execFileSync('git', ['tag', '--list', '*--v*'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const repo = loadRepo(process.cwd());
  // Plan against "tags that also have a Release", so a run that tagged but failed to create
  // the Release is completed on the next run (idempotent).
  const hasRelease = (tag) => {
    if (dryRun) return true;
    try { execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore' }); return true; } catch { return false; }
  };
  const done = existing.filter(hasRelease);
  const plan = planReleases(repo, done);
  if (plan.length === 0) {
    console.log('release: every plugin version is already tagged and released — nothing to do');
    process.exit(0);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'release-notes-'));
  for (const r of plan) {
    console.log(`release: ${r.tag}`);
    if (dryRun) { console.log(r.notes); continue; }
    // Annotated tag; checks plugin.json and the catalogue entry agree; needs a clean tree.
    if (!existing.includes(r.tag)) run('claude', ['plugin', 'tag', `plugins/${r.dir}`, '--push']);
    const notesFile = join(tmp, `${r.tag}.md`);
    writeFileSync(notesFile, r.notes + '\n');
    run('gh', ['release', 'create', r.tag, '--title', `${r.plugin} v${r.version}`, '--notes-file', notesFile, '--verify-tag']);
  }
}
