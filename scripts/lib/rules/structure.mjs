// Plugin layout: required files exist and parse, manifest basics, no placeholders in SKILL.md /
// README.md, and every references/, scripts/ or assets/ path a SKILL.md mentions exists.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isValid } from '../semver.mjs';
import { f, readText, PLACEHOLDER } from './_util.mjs';

const ID = 'structure';
// `references/x.md` in backticks, or a markdown link target (optionally ./-prefixed).
const REF_RE = /(?:`|\]\()(?:\.\/)?((?:references|scripts|assets)\/[^\s`)#]+)/g;

/** [{line, text}] for a markdown placeholder, ignoring fenced code blocks and inline code spans. */
export function placeholders(md) {
  const out = [];
  let fenced = false;
  for (const [i, line] of md.split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = PLACEHOLDER.exec(line.replace(/`[^`]*`/g, ''));
    if (m) out.push({ line: i + 1, text: m[0] });
  }
  return out;
}

/** [{line, path}] for each references/, scripts/ or assets/ path the markdown mentions. */
export function skillRefs(md) {
  const out = [];
  for (const [i, line] of md.split('\n').entries()) {
    for (const m of line.matchAll(REF_RE)) out.push({ line: i + 1, path: m[1] });
  }
  return out;
}

export default {
  id: ID,
  group: 'plugins',
  run({ root, repo }) {
    const out = [];
    for (const p of repo.plugins) {
      for (const e of p.loadErrors) out.push(f(ID, 'ERROR', e.file, e.message));
      for (const req of ['README.md', 'CHANGELOG.md']) {
        if (!p.files.includes(`${p.path}/${req}`)) out.push(f(ID, 'ERROR', `${p.path}/${req}`, 'missing'));
      }
      const readme = readText(root, `${p.path}/README.md`);
      for (const x of readme ? placeholders(readme) : []) out.push(f(ID, 'ERROR', `${p.path}/README.md`, `placeholder "${x.text}"`, x.line));
      if (!p.skills.length) out.push(f(ID, 'ERROR', `${p.path}/skills`, 'plugin has no skills'));
      for (const s of p.skills) {
        const file = `${s.path}/SKILL.md`;
        if (s.skillMd === null) {
          out.push(f(ID, 'ERROR', file, 'missing'));
          continue;
        }
        for (const x of placeholders(s.skillMd)) out.push(f(ID, 'ERROR', file, `placeholder "${x.text}"`, x.line));
        for (const r of skillRefs(s.skillMd)) {
          if (!existsSync(join(root, s.path, r.path))) {
            out.push(f(ID, 'ERROR', file, `references "${r.path}", which does not exist in the skill folder`, r.line));
          }
        }
      }
      const m = p.manifest;
      if (m) {
        const file = `${p.path}/.claude-plugin/plugin.json`;
        if (!isValid(m.version)) out.push(f(ID, 'ERROR', file, `version "${m.version}" is not MAJOR.MINOR.PATCH`));
        if (typeof m.description !== 'string' || !m.description.trim()) out.push(f(ID, 'ERROR', file, 'description is required'));
        if (typeof m.author?.name !== 'string' || !m.author.name) out.push(f(ID, 'ERROR', file, 'author.name is required'));
        if (m.license !== 'MIT') out.push(f(ID, 'ERROR', file, `license must be "MIT" (got ${JSON.stringify(m.license)})`));
      }
    }
    return out;
  },
};
