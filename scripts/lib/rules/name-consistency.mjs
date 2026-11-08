// Folder == manifest name, kebab-case, no reserved prefix.
import { NAME_RE, RESERVED_PREFIXES } from '../plugins.mjs';
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
    }
    return out;
  },
};
