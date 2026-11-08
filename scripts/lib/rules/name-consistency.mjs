// Folder == manifest name, kebab-case, no reserved prefix; evals.json skill_name == SKILL.md name.
import { NAME_RE, RESERVED_PREFIXES } from '../plugins.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { f } from './_util.mjs';

const ID = 'name-consistency';

export default {
  id: ID,
  group: 'plugins',
  run({ repo }) {
    const out = [];
    for (const p of repo.plugins) {
      const file = `${p.path}/.claude-plugin/plugin.json`;
      const name = p.manifest?.name;
      if (p.manifest) {
        if (name !== p.dir) out.push(f(ID, 'ERROR', file, `manifest name "${name}" must equal folder name "${p.dir}"`));
        if (typeof name !== 'string' || !NAME_RE.test(name)) out.push(f(ID, 'ERROR', file, `name "${name}" must be kebab-case`));
      }
      for (const n of new Set([p.dir, name].filter(Boolean))) {
        const pre = RESERVED_PREFIXES.find((r) => String(n).startsWith(r));
        if (pre) out.push(f(ID, 'ERROR', file, `name "${n}" uses reserved prefix "${pre}"`));
      }
      for (const s of p.skills) {
        if (!s.skillMd || !s.evals) continue;
        const fmName = parseFrontmatter(s.skillMd).data.name;
        if (s.evals.skill_name !== fmName) {
          out.push(f(ID, 'ERROR', `${s.path}/evals/evals.json`, `skill_name "${s.evals.skill_name}" must equal SKILL.md name "${fmName}"`));
        }
      }
    }
    return out;
  },
};
