#!/usr/bin/env node
// npm run bump <name> patch|minor|major [--root <dir>] [--force]
// Bumps plugin.json version and adds a dated CHANGELOG stub. Refuses to bump a version that has
// not been released yet (no `<name>--v<current>` tag), so versions are never stacked unreleased.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bump as bumpVersion } from './lib/semver.mjs';
import { stableJson } from './lib/plugins.mjs';
import { today as todayIso } from './new-plugin.mjs';

export const tagName = (name, version) => `${name}--v${version}`;

/** Insert `## [version] - date` stub before the first version heading (i.e. after the title). */
export function insertChangelogStub(text, version, date) {
  const stub = `## [${version}] - ${date}\n\n### Changed\n- TODO\n`;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^##\s/.test(l));
  if (i === -1) return `${text.replace(/\n*$/, '')}\n\n${stub}`;
  lines.splice(i, 0, ...stub.split('\n'));
  return lines.join('\n');
}

/**
 * @param {string} root
 * @param {string} name plugin folder
 * @param {'patch'|'minor'|'major'} level
 * @param {{existingTags:string[], force?:boolean, today?:string}} opts
 * @returns {{from:string, to:string}}
 */
export function bump(root, name, level, { existingTags, force = false, today = todayIso() }) {
  const dir = join(root, 'plugins', name);
  const manifestFile = join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestFile)) throw new Error(`plugins/${name}/.claude-plugin/plugin.json not found`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const from = manifest.version;
  const to = bumpVersion(from, level);
  if (!force && !existingTags.includes(tagName(name, from))) {
    throw new Error(
      `${name} ${from} is not released yet (no tag ${tagName(name, from)}); ` +
        `edit its CHANGELOG section instead of bumping again, or pass --force`,
    );
  }
  manifest.version = to;
  writeFileSync(manifestFile, stableJson(manifest));
  const clFile = join(dir, 'CHANGELOG.md');
  const cl = existsSync(clFile) ? readFileSync(clFile, 'utf8') : '# Changelog\n';
  writeFileSync(clFile, insertChangelogStub(cl, to, today));
  return { from, to };
}

function localTags(root, name) {
  try {
    return execFileSync('git', ['-C', root, 'tag', '-l', `${name}--v*`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { root: { type: 'string', default: process.cwd() }, force: { type: 'boolean', default: false } },
  });
  const [name, level] = positionals;
  if (!name || !level) {
    console.error('usage: npm run bump <name> patch|minor|major [--force]');
    process.exit(1);
  }
  try {
    const { from, to } = bump(values.root, name, level, { existingTags: localTags(values.root, name), force: values.force });
    console.log(`${name}: ${from} -> ${to}`);
    console.log(`Fill in the ${to} entry in plugins/${name}/CHANGELOG.md, then npm run check`);
  } catch (e) {
    console.error(`bump: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
